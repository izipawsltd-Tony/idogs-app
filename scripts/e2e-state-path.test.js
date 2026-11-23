import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const ENV = 'E2E_PREVIEW_STATE_FILE'

async function load() {
  vi.resetModules()
  delete process.env[ENV]
  const m = await import('../e2e/support/state-path.ts')

  return m
}

describe('e2e preview state file (private, per run, cleaned up)', () => {
  const dirs = []
  afterEach(() => {
    // Each module instance created its own directory; remove every one (cleanup is per-process-env).
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
    delete process.env[ENV]
  })

  it('is unique per run and lives in its own directory', async () => {
    const a = await load(); dirs.push(dirname(a.previewStateFile()))
    const pa = a.previewStateFile()
    const b = await load(); dirs.push(dirname(b.previewStateFile()))
    const pb = b.previewStateFile()
    expect(pa).not.toBe(pb)
    expect(pa).toMatch(/idogs-preview-state-[^/\\]+[/\\]state\.json$/)
  })

  it('is stable inside one run (workers inherit the same path)', async () => {
    const a = await load(); dirs.push(dirname(a.previewStateFile()))
    expect(a.previewStateFile()).toBe(a.previewStateFile())
    expect(a.PREVIEW_STATE).toBe(a.previewStateFile())
  })

  it('writes owner-only: directory 0700, file 0600', async () => {
    if (process.platform === 'win32') return
    const a = await load(); dirs.push(dirname(a.previewStateFile()))
    a.writePreviewState('{"cookies":[],"origins":[]}')
    const file = a.previewStateFile()
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700)
    expect(readFileSync(file, 'utf8')).toBe('{"cookies":[],"origins":[]}')
  })

  it('cleanup removes the directory and is safe to repeat', async () => {
    const a = await load(); dirs.push(dirname(a.previewStateFile()))
    a.writePreviewState('{}')
    const file = a.previewStateFile()
    a.cleanupPreviewState()
    expect(existsSync(file)).toBe(false)
    expect(existsSync(dirname(file))).toBe(false)
    expect(() => a.cleanupPreviewState()).not.toThrow()
  })

  it('never lands under report or result folders', async () => {
    const a = await load(); dirs.push(dirname(a.previewStateFile()))
    expect(a.previewStateFile()).not.toMatch(/playwright-report|test-results/)
  })
})
