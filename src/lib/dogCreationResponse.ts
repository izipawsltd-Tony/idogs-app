export class DogCreationUnconfirmedError extends Error {
  constructor() {
    super('Dog creation could not be confirmed')
    this.name = 'DogCreationUnconfirmedError'
  }
}

// A successful HTTP response alone does not prove which Dog was committed.
// Do not navigate or attach follow-up records to an absent/invalid document ID.
export function confirmedCreatedDogId(value: unknown): string {
  if (!value || typeof value !== 'object') throw new DogCreationUnconfirmedError()
  const result = value as Record<string, unknown>
  const id = result.dogId
  if (result.ok === false || typeof id !== 'string' || !id.trim() ||
      id !== id.trim() || id.includes('/') || id === '.' || id === '..' ||
      id === 'undefined' || id === 'null') {
    throw new DogCreationUnconfirmedError()
  }
  return id
}
