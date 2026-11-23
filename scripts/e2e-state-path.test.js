import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ENV = 'E2E_PREVIEW_STATE_FILE'
const owners = []

async function fresh({ keepEnv = false } = {}) {
  vi.resetModules()
  if (!keepEnv) delete process.env[ENV]
  const m = await import('../e2e/support/state-path.ts')
  return m
}
afterEach(() => {
  for (const m of owners.splice(0)) { try { m.cleanupPreviewState() } catch { /* test teardown */ } }
  delete process.env[ENV]
  vi.doUnmock('node:fs'); vi.resetModules()
})

describe('e2e preview state file (private, per run, owner-only cleanup)', () => {
  it('is unique per run and lives in its own directory under the OS temp dir', async () => {
    const a = await fresh(); owners.push(a)
    const pa = a.previewStateFile()
    const b = await fresh(); owners.push(b)
    expect(pa).not.toBe(b.previewStateFile())
    expect(pa).toMatch(/idogs-preview-state-[^/\\]+[/\\]state\.json$/)
    expect(pa).not.toMatch(/playwright-report|test-results/)
  })

  it('is stable inside one run', async () => {
    const a = await fresh(); owners.push(a)
    expect(a.previewStateFile()).toBe(a.previewStateFile())
    expect(a.PREVIEW_STATE).toBe(a.previewStateFile())
  })

  it('creates the file owner-only: directory 0700, file 0600, cookie-only content', async () => {
    if (process.platform === 'win32') return
    const a = await fresh(); owners.push(a)
    a.writePreviewState('{"cookies":[],"origins":[]}')
    const f = a.previewStateFile()
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(f)).mode & 0o777).toBe(0o700)
    expect(readFileSync(f, 'utf8')).toBe('{"cookies":[],"origins":[]}')
  })

  it('the owner removes its directory, and a repeat is safe', async () => {
    const a = await fresh(); owners.push(a)
    a.writePreviewState('{}')
    const dir = dirname(a.previewStateFile())
    a.cleanupPreviewState()
    expect(existsSync(dir)).toBe(false)
    expect(() => a.cleanupPreviewState()).not.toThrow()
  })

  it('a worker that only INHERITS the path validates it and never deletes it', async () => {
    const owner = await fresh(); owners.push(owner)
    owner.writePreviewState('{"cookies":[],"origins":[]}')
    const f = owner.previewStateFile()
    const worker = await fresh({ keepEnv: true })
    expect(worker.previewStateFile()).toBe(f)
    worker.cleanupPreviewState() // not the owner: must be a no-op
    expect(existsSync(f)).toBe(true)
    owner.cleanupPreviewState()
    expect(existsSync(f)).toBe(false)
  })

  it('rejects an inherited path that is not a private runner path (cannot steer a delete)', async () => {
    const victim = mkdtempSync(join(tmpdir(), 'not-a-runner-dir-'))
    writeFileSync(join(victim, 'keep.txt'), 'x')
    try {
      for (const bad of [victim, join(victim, 'state.json'), '/', '/etc/state.json', join(tmpdir(), 'idogs-preview-state-x', '..', 'state.json'), join(victim, 'idogs-preview-state-y', 'state.json')]) {
        process.env[ENV] = bad
        vi.resetModules()
        await expect(import('../e2e/support/state-path.ts')).rejects.toThrow(/not a private state path/)
      }
      expect(existsSync(join(victim, 'keep.txt'))).toBe(true)
    } finally { rmSync(victim, { recursive: true, force: true }); delete process.env[ENV] }
  })

  it('surfaces a cleanup failure instead of swallowing it', async () => {
    vi.resetModules(); delete process.env[ENV]
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual('node:fs')
      return { ...actual, rmSync: () => { throw new Error('EBUSY: simulated') } }
    })
    const a = await import('../e2e/support/state-path.ts')
    a.previewStateFile()
    expect(() => a.cleanupPreviewState()).toThrow(/EBUSY/)
    const dir = dirname(process.env[ENV])
    vi.doUnmock('node:fs')
    rmSync(dir, { recursive: true, force: true })
  })
})
