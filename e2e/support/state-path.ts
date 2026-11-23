import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

// Private, per-run home for the Vercel bypass cookie state (host-only cookie, never a secret
// header). The path must be identical in the Playwright main process, globalSetup and every
// worker, so the creating process publishes it in an environment variable that workers inherit.
//
// Ownership rules (Codex #7090807887):
// - Only the process that ALLOCATED the directory (mkdtemp, random name, 0700) may delete it.
//   A process that merely inherits the variable validates the path and never owns it.
// - An inherited path must look exactly like one this runner allocates (direct child of the OS temp
//   dir, `idogs-preview-state-*`, file `state.json`); anything else is rejected, so the variable can
//   never steer a recursive delete somewhere else.
// - Cleanup failures are surfaced, never swallowed.
const ENV = 'E2E_PREVIEW_STATE_FILE'
const PREFIX = 'idogs-preview-state-'
let ownedDir: string | undefined

function tmpRoot(): string {
  return realpathSync(tmpdir())
}

// Throws unless `file` is a state path of the form <tmp>/idogs-preview-state-XXXX/state.json.
export function assertPrivateStatePath(file: string): void {
  const dir = dirname(file)
  let parentOk = false
  try { parentOk = realpathSync(dirname(dir)) === tmpRoot() } catch { parentOk = false }
  if (basename(file) !== 'state.json' || !basename(dir).startsWith(PREFIX) || !parentOk) {
    throw new Error(`${ENV} is not a private state path allocated by this runner`)
  }
}

export function previewStateFile(): string {
  const inherited = process.env[ENV]
  if (inherited) {
    assertPrivateStatePath(inherited) // inherited: validated, NOT owned
    return inherited
  }
  const dir = mkdtempSync(join(tmpdir(), PREFIX))
  chmodSync(dir, 0o700)
  ownedDir = dir
  process.env[ENV] = join(dir, 'state.json')
  // Only the owner reaches here, so only the owner registers the exit fallback.
  process.once('exit', () => {
    try { cleanupPreviewState() } catch (e) {
      process.stderr.write(`preview state cleanup failed: ${e instanceof Error ? e.message : 'unknown error'}\n`)
    }
  })
  return process.env[ENV]!
}

/** Create the (cookie-only) state file directly with owner-only permissions (0600). */
export function writePreviewState(json: string): void {
  const file = previewStateFile()
  writeFileSync(file, json, { mode: 0o600 })
  chmodSync(file, 0o600)
}

/**
 * Remove the directory THIS process allocated. No-op (never a delete) for a process that only
 * inherited the path. Throws if removal fails or the directory is still there afterwards.
 */
export function cleanupPreviewState(): void {
  if (!ownedDir) return
  const dir = ownedDir
  rmSync(dir, { recursive: true, force: true })
  if (existsSync(dir)) throw new Error('private preview state directory still exists after cleanup')
  ownedDir = undefined
}

export const PREVIEW_STATE = previewStateFile()
