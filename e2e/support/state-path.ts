import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Private, per-run home for the Vercel bypass cookie state (host-only cookie, never a secret
// header). The path must be identical in the Playwright main process, globalSetup and every
// worker, so it is created once and published through an environment variable that workers
// inherit. The directory is created by mkdtemp (random name, mode 0700), the file is 0600, both
// live in the OS temp dir (never in playwright-report/ or test-results/, so never uploaded),
// and the creating process removes them on exit; globalTeardown removes them on a normal finish.
const ENV = 'E2E_PREVIEW_STATE_FILE'

export function previewStateFile(): string {
  if (!process.env[ENV]) {
    const dir = mkdtempSync(join(tmpdir(), 'idogs-preview-state-'))
    chmodSync(dir, 0o700)
    process.env[ENV] = join(dir, 'state.json')
    // Only the creating process registers this; workers inherit the variable and never reach here.
    process.once('exit', () => cleanupPreviewState())
  }
  return process.env[ENV]!
}

/** Write the (cookie-only) state with owner-only permissions. */
export function writePreviewState(json: string): void {
  const file = previewStateFile()
  writeFileSync(file, json, { mode: 0o600 })
  chmodSync(file, 0o600)
}

/** Restrict a file written by Playwright itself (storageState({ path })) to the owner. */
export function lockPreviewState(): void {
  chmodSync(previewStateFile(), 0o600)
}

/** Remove the private directory and its contents. Safe to call repeatedly or when nothing exists. */
export function cleanupPreviewState(): void {
  const file = process.env[ENV]
  if (!file) return
  try {
    rmSync(join(file, '..'), { recursive: true, force: true })
  } catch {
    // best effort: the directory is private (0700) in the OS temp dir
  }
}

export const PREVIEW_STATE = previewStateFile()
