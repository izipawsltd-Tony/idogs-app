import { containsDeletionIdentity, digest } from './deletion-plan.js'

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// Read-only candidates for restore quarantine, never deletion authority.
// Dog scope must come from the approved original manifest, not restored data.
export function scopedRestoredRecords({ records, uid, dogIds, emailHashes = [] }) {
  if (!id(uid) || !Array.isArray(dogIds) || dogIds.length > 25
    || dogIds.some(value => !id(value)) || new Set(dogIds).size !== dogIds.length
    || !Array.isArray(emailHashes) || emailHashes.length > 5
    || emailHashes.some(value => !/^[a-f0-9]{64}$/.test(value))) throw Error('RESTORE_DISCOVERY_SCOPE_REQUIRED')
  if (!Array.isArray(records) || records.length > 5000) throw Error('RESTORE_DISCOVERY_INCOMPLETE')
  const dogs = new Set(dogIds), paths = new Set(), selected = []
  for (const record of records) {
    const segments = typeof record?.path === 'string' ? record.path.split('/') : []
    if (segments.length < 2 || segments.length > 100 || segments.length % 2
      || segments.some(segment => !segment || segment === '.' || segment === '..')
      || paths.has(record.path) || !record.data || typeof record.data !== 'object'
      || Array.isArray(record.data)) throw Error('RESTORE_DISCOVERY_RECORD_INVALID')
    paths.add(record.path)
    const accountPath = segments[1] === uid
    const dogPath = dogs.has(segments[1]) || segments.some((segment, index) =>
      index % 2 === 0 && segment === 'dogs' && dogs.has(segments[index + 1]))
    if (accountPath || dogPath || containsDeletionIdentity(record.data, uid, emailHashes)) {
      selected.push({ path: record.path, dataHash: digest(record.data) })
    }
  }
  return selected.sort((a, b) => a.path.localeCompare(b.path))
}
