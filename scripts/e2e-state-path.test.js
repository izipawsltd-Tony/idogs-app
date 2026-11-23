import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ENV = 'E2E_PREVIEW_STATE_FILE'
const POSIX = process.platform !== 'win32' // owner/mode and symlink creation checks are BLOCKED (not run) on Windows
const owners = []
const scratch = []

async function fresh({ keepEnv = false } = {}) {
  vi.resetModules()
  if (!keepEnv) delete process.env[ENV]
  return import('../e2e/support/state-path.ts')
}
const tmpRoot = () => realpathSync(tmpdir())
function makeState({ dirMode = 0o700, fileMode = 0o600, name = 'idogs-preview-state-t' + Math.random().toString(36).slice(2, 8) } = {}) {
  const dir = join(tmpRoot(), name)
  mkdirSync(dir, { mode: dirMode }); chmodSync(dir, dirMode)
  const file = join(dir, 'state.json')
  writeFileSync(file, '{"cookies":[],"origins":[]}', { mode: fileMode }); chmodSync(file, fileMode)
  scratch.push(dir)
  return { dir, file }
}
async function consumeFails(path, re) {
  process.env[ENV] = path
  vi.resetModules()
  await expect(import('../e2e/support/state-path.ts')).rejects.toThrow(re)
  delete process.env[ENV]
}
afterEach(() => {
  for (const m of owners.splice(0)) { try { m.cleanupPreviewState() } catch { /* test teardown */ } }
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env[ENV]
  vi.doUnmock('node:fs'); vi.resetModules()
})

describe('allocator', () => {
  it('is unique per run, private, and outside report/result folders', async () => {
    const a = await fresh(); owners.push(a); const pa = a.previewStateFile()
    expect(a.previewStateFile()).toBe(pa) // stable inside one run
    expect(pa).toMatch(/idogs-preview-state-[^/\\]+[/\\]state\.json$/)
    expect(pa).not.toMatch(/playwright-report|test-results/)
    const b = await fresh(); owners.push(b)
    expect(b.previewStateFile()).not.toBe(pa) // a new run allocates a new directory
  })

  it.skipIf(!POSIX)('creates the file exclusively with owner-only permissions (dir 0700, file 0600)', async () => {
    const a = await fresh(); owners.push(a)
    a.writePreviewState('{"cookies":[],"origins":[]}')
    const f = a.previewStateFile()
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(f)).mode & 0o777).toBe(0o700)
    expect(readFileSync(f, 'utf8')).toBe('{"cookies":[],"origins":[]}')
    expect(() => a.writePreviewState('{}')).toThrow() // exclusive create: never overwrites
  })

  it('removes only its own directory, repeat is safe, and a failed removal is surfaced', async () => {
    const a = await fresh(); owners.push(a); a.writePreviewState('{}')
    const dir = dirname(a.previewStateFile())
    a.cleanupPreviewState(); expect(existsSync(dir)).toBe(false)
    expect(() => a.cleanupPreviewState()).not.toThrow()
  })

  it('surfaces a cleanup failure instead of swallowing it', async () => {
    vi.resetModules(); delete process.env[ENV]
    vi.doMock('node:fs', async () => ({ ...(await vi.importActual('node:fs')), rmSync: () => { throw new Error('EBUSY: simulated') } }))
    const a = await import('../e2e/support/state-path.ts'); a.previewStateFile()
    const dir = dirname(process.env[ENV])
    expect(() => a.cleanupPreviewState()).toThrow(/EBUSY/)
    vi.doUnmock('node:fs'); rmSync(dir, { recursive: true, force: true })
  })

  it.skipIf(!POSIX)('refuses to delete when its directory was replaced by a symlink (target untouched)', async () => {
    const a = await fresh(); a.previewStateFile()
    const dir = dirname(process.env[ENV])
    const victim = mkdtempSync(join(tmpRoot(), 'victim-')); scratch.push(victim)
    writeFileSync(join(victim, 'keep.txt'), 'x')
    rmSync(dir, { recursive: true, force: true }); symlinkSync(victim, dir)
    expect(() => a.cleanupPreviewState()).toThrow(/replaced/)
    expect(existsSync(join(victim, 'keep.txt'))).toBe(true)
    rmSync(dir, { force: true })
  })
})

describe('consumer (worker): reads an existing trusted state only', () => {
  it('accepts the allocator\'s real state, cannot write, and never deletes it', async () => {
    const owner = await fresh(); owners.push(owner); owner.writePreviewState('{"cookies":[],"origins":[]}')
    const f = owner.previewStateFile()
    const worker = await fresh({ keepEnv: true })
    expect(worker.previewStateFile()).toBe(f)
    expect(() => worker.writePreviewState('{"cookies":[{"x":1}]}')).toThrow(/only the process that allocated/)
    worker.cleanupPreviewState(); expect(existsSync(f)).toBe(true)
    expect(readFileSync(f, 'utf8')).toBe('{"cookies":[],"origins":[]}')
  })

  it('REGRESSION (Codex P1): a nonexistent lookalike path fails closed', async () => {
    await consumeFails(join(tmpRoot(), 'idogs-preview-state-doesnotexist', 'state.json'), /existing runner-allocated state/)
    expect(existsSync(join(tmpRoot(), 'idogs-preview-state-doesnotexist'))).toBe(false) // and nothing was created
  })

  it('rejects paths that are not a runner state path (wrong name/location, traversal)', async () => {
    const victim = mkdtempSync(join(tmpRoot(), 'not-a-runner-dir-')); scratch.push(victim); writeFileSync(join(victim, 'keep.txt'), 'x')
    for (const bad of [victim, join(victim, 'state.json'), '/', '/etc/state.json', join(victim, 'idogs-preview-state-y', 'state.json'), join(tmpRoot(), 'idogs-preview-state-x', '..', 'state.json')]) {
      await consumeFails(bad, /private state path|existing runner-allocated|resolves outside/)
    }
    expect(existsSync(join(victim, 'keep.txt'))).toBe(true)
  })

  it.skipIf(!POSIX)('rejects a state directory or file accessible to others', async () => {
    await consumeFails(makeState({ dirMode: 0o755 }).file, /accessible to other users/)
    await consumeFails(makeState({ fileMode: 0o644 }).file, /accessible to other users/)
  })

  it.skipIf(!POSIX)('rejects a symlinked directory (redirected state)', async () => {
    const real = makeState()
    const link = join(tmpRoot(), 'idogs-preview-state-link' + Math.random().toString(36).slice(2, 6))
    symlinkSync(real.dir, link); scratch.push(link)
    await consumeFails(join(link, 'state.json'), /redirected through a link/)
  })

  it.skipIf(!POSIX)('rejects a symlinked state file (redirected to another file)', async () => {
    const real = makeState()
    const other = makeState()
    rmSync(real.file); symlinkSync(other.file, real.file)
    await consumeFails(real.file, /redirected through a link/)
  })

  it.skipIf(!POSIX)('accepts a correctly private pre-existing state (owner-only, real paths)', async () => {
    const s = makeState()
    process.env[ENV] = s.file; vi.resetModules()
    const m = await import('../e2e/support/state-path.ts')
    expect(m.previewStateFile()).toBe(s.file)
    expect(() => m.writePreviewState('{}')).toThrow(/only the process that allocated/)
  })
})
