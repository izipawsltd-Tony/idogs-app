import { lazy, type ComponentType } from 'react'

// Route code-splitting safety: after a new deployment, a tab that is still
// running the previous build asks for chunk files that no longer exist
// ("Failed to fetch dynamically imported module"). Reload the page once so
// the visitor gets the new build instead of a blank screen. A session flag
// prevents reload loops if the network is genuinely down.
const FLAG = 'idogs-chunk-reload'
export function isChunkLoadError(err: unknown): boolean {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i.test(m)
}
type W = Pick<Window, 'location' | 'sessionStorage'>
export async function loadWithReload<M>(load: () => Promise<M>, w: W = window): Promise<M> {
  try {
    const mod = await load()
    try { w.sessionStorage.removeItem(FLAG) } catch { /* optional */ }
    return mod
  } catch (err) {
    let reloaded = false
    try { reloaded = w.sessionStorage.getItem(FLAG) === '1' } catch { /* optional */ }
    if (isChunkLoadError(err) && !reloaded) {
      try { w.sessionStorage.setItem(FLAG, '1') } catch { /* optional */ }
      w.location.reload()
      return new Promise<M>(() => {})
    }
    throw err
  }
}
export function lazyWithReload<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => loadWithReload(load))
}
