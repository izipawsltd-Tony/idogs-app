import { chmodSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

// Private, per-run home for the Vercel bypass cookie state (host-only cookie, never a secret header).
// The allocating process publishes the path in an environment variable that workers inherit.
//
// Ownership (Codex #7090603661, #7091846447, ChatGPT #7091934574):
// - ONLY the allocator (the process that mkdtemp'd the directory, random name, 0700) may create, write or
//   delete anything. `writePreviewState` throws in any other process; the file is created exclusively
//   (`wx`, 0600), so an existing file or symlink at the target is refused.
// - A worker only CONSUMES a state that already exists and is trusted: the directory and file must exist,
//   must not be symlinks/junctions, must resolve to <tmp>/idogs-preview-state-XXXX[/state.json] with no
//   redirection, and on POSIX must be owned by this user with no group/other access (0700 / 0600).
//   An inherited path that is missing, a lookalike, redirected or too permissive fails closed.
// - Cleanup deletes only the allocator's own directory, re-checks it is still a real directory first, and
//   surfaces failures.
// - Windows: POSIX owner/mode checks cannot be performed. Symlink/junction and realpath checks still run;
//   the owner/mode assertions are BLOCKED there (documented in the tests, never silently assumed).
const ENV = 'E2E_PREVIEW_STATE_FILE'
const PREFIX = 'idogs-preview-state-'
const POSIX = process.platform !== 'win32'
let ownedDir: string | undefined

const tmpRoot = () => realpathSync(tmpdir())

function assertShape(file: string): void {
  const dir = dirname(file)
  if (basename(file) !== 'state.json' || !basename(dir).startsWith(PREFIX)) {
    throw new Error(`${ENV} is not a private state path allocated by this runner`)
  }
}

/** A worker may only consume an EXISTING, trusted state: real (non-symlink) paths, no redirection, owner-only. */
export function assertTrustedExistingState(file: string): void {
  assertShape(file)
  const dir = dirname(file)
  let dst, fst
  try { dst = lstatSync(dir); fst = lstatSync(file) } catch { throw new Error(`${ENV} does not point at an existing runner-allocated state`) }
  if (dst.isSymbolicLink() || fst.isSymbolicLink()) throw new Error(`${ENV} is redirected through a link`)
  if (!dst.isDirectory() || !fst.isFile()) throw new Error(`${ENV} is not a directory/file pair`)
  if (realpathSync(dir) !== join(tmpRoot(), basename(dir)) || realpathSync(file) !== join(tmpRoot(), basename(dir), 'state.json')) {
    throw new Error(`${ENV} resolves outside the runner temp directory`)
  }
  if (POSIX) {
    if (typeof process.getuid === 'function' && (dst.uid !== process.getuid() || fst.uid !== process.getuid())) throw new Error(`${ENV} is not owned by the current user`)
    if ((dst.mode & 0o077) !== 0 || (fst.mode & 0o077) !== 0) throw new Error(`${ENV} is accessible to other users`)
  }
}

export function previewStateFile(): string {
  const inherited = process.env[ENV]
  if (inherited) {
    if (ownedDir && inherited === join(ownedDir, 'state.json')) return inherited // the allocator itself
    assertTrustedExistingState(inherited) // a consumer: validated, never owned, never writes
    return inherited
  }
  const dir = mkdtempSync(join(tmpdir(), PREFIX))
  chmodSync(dir, 0o700)
  ownedDir = dir
  process.env[ENV] = join(dir, 'state.json')
  process.once('exit', () => {
    try { cleanupPreviewState() } catch (e) {
      process.stderr.write(`preview state cleanup failed: ${e instanceof Error ? e.message : 'unknown error'}\n`)
    }
  })
  return process.env[ENV]!
}

/** Allocator only. Creates the cookie-only state exclusively, 0600; never overwrites or follows a link. */
export function writePreviewState(json: string): void {
  if (!ownedDir) throw new Error('only the process that allocated the private state directory may write it')
  const dst = lstatSync(ownedDir)
  if (dst.isSymbolicLink() || !dst.isDirectory()) throw new Error('private state directory was replaced')
  const file = join(ownedDir, 'state.json')
  writeFileSync(file, json, { mode: 0o600, flag: 'wx' })
  if (lstatSync(file).isSymbolicLink()) throw new Error('private state file is a link')
  if (POSIX) chmodSync(file, 0o600)
}

/** Remove the directory THIS process allocated; no-op for a consumer. Throws on failure. */
export function cleanupPreviewState(): void {
  if (!ownedDir) return
  const dir = ownedDir
  if (existsSync(dir)) {
    const st = lstatSync(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('private state directory was replaced; refusing to delete')
  }
  rmSync(dir, { recursive: true, force: true })
  if (existsSync(dir)) throw new Error('private preview state directory still exists after cleanup')
  ownedDir = undefined
}

export const PREVIEW_STATE = previewStateFile()
