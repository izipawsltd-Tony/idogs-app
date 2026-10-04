import { describe, expect, it } from 'vitest'
import { confirmedCreatedDogId, DogCreationUnconfirmedError } from './dogCreationResponse'

describe('confirmedCreatedDogId', () => {
  it('accepts the server document ID without changing it', () => {
    expect(confirmedCreatedDogId({ ok: true, dogId: 'dog-123', passportId: 'QA-2023-ABCD' })).toBe('dog-123')
    expect(confirmedCreatedDogId({ dogId: 'legacy-id' })).toBe('legacy-id')
  })
  it.each([null, {}, [], { ok: false, dogId: 'dog-123' }, { dogId: 123 },
    ...['', ' ', ' undefined ', 'undefined', 'null', '.', '..', 'dogs/123'].map(dogId => ({ dogId }))])
  ('rejects an unconfirmed result without inventing an ID: %j', result => {
    expect(() => confirmedCreatedDogId(result)).toThrow(DogCreationUnconfirmedError)
  })
})
