import { expect, it, vi } from 'vitest'
import { isChunkLoadError } from './lazyWithReload'
it('recognises stale-deployment chunk errors across browsers', () => {
  expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://idogs.com.au/assets/DogDetailPage-old.js'))).toBe(true)
  expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
  expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
})
it('reloads once on a stale chunk, then lets a second failure surface (no reload loop)', async () => {
  const { loadWithReload } = await import('./lazyWithReload')
  const store = new Map<string, string>()
  const w = { location: { reload: vi.fn() }, sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } } as any
  const fail = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: x.js'))
  void loadWithReload(fail, w)
  await new Promise(r => setTimeout(r, 0))
  expect(w.location.reload).toHaveBeenCalledTimes(1)
  await expect(loadWithReload(fail, w)).rejects.toThrow(/dynamically imported/)
  expect(w.location.reload).toHaveBeenCalledTimes(1)
  await expect(loadWithReload(async () => ({ default: 1 }), w)).resolves.toEqual({ default: 1 })
  expect(store.has('idogs-chunk-reload')).toBe(false)
})
it('never reloads for ordinary errors', async () => {
  const { loadWithReload } = await import('./lazyWithReload')
  const w = { location: { reload: vi.fn() }, sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } } as any
  await expect(loadWithReload(() => Promise.reject(new Error('boom')), w)).rejects.toThrow('boom')
  expect(w.location.reload).not.toHaveBeenCalled()
})
