import { describe, expect, it, vi } from 'vitest'
import { runWithTeardown } from '../e2e/support/runWithTeardown.ts'

describe('runWithTeardown: teardown always runs, the test failure is never replaced', () => {
  it('returns the body result and runs teardown', async () => {
    const td = vi.fn(async () => {})
    await expect(runWithTeardown(async () => 42, td)).resolves.toBe(42)
    expect(td).toHaveBeenCalledTimes(1)
  })
  it('runs teardown when the body fails and keeps the ORIGINAL error', async () => {
    const td = vi.fn(async () => { throw new Error('teardown boom') })
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(runWithTeardown(async () => { throw new Error('test failed') }, td)).rejects.toThrow('test failed')
    expect(td).toHaveBeenCalledTimes(1)
    expect(err.mock.calls.join('')).toContain('teardown also failed')
    err.mockRestore()
  })
  it('fails the run when the body passed but teardown failed', async () => {
    await expect(runWithTeardown(async () => 'ok', async () => { throw new Error('teardown incomplete') })).rejects.toThrow('teardown incomplete')
  })
  it('runs teardown after a failing body even when teardown succeeds', async () => {
    const td = vi.fn(async () => {})
    await expect(runWithTeardown(async () => { throw new Error('x') }, td)).rejects.toThrow('x')
    expect(td).toHaveBeenCalledTimes(1)
  })
})
