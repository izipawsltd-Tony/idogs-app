type DogUsageChangedListener = (uid: string) => void

const listeners = new Set<DogUsageChangedListener>()

// Notify the persistent layout after a server-confirmed mutation changes dog
// usage. Scope every notification to a uid so account switches cannot refresh
// (or display results for) the wrong user.
export function emitDogUsageChanged(uid: string): void {
  if (!uid) return
  for (const listener of listeners) listener(uid)
}

export function subscribeToDogUsageChanged(listener: DogUsageChangedListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
