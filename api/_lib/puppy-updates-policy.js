import { hasDogWriteAccess, canAddDogRecord } from './dog-access.js'
import { grantAllowsBuyerRead } from './private-dog-access.js'

export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export const ownerId = dog => Object.hasOwn(dog || {}, 'currentOwnerId') ? dog.currentOwnerId : dog?.tenantId
export const canPublish = (dog, uid) => canAddDogRecord(dog, uid) && dog.status !== 'transferred' && dog.transferStatus !== 'pendingClaim'
export const publicSharingLive = (dog, profile) => !!ownerId(dog) && profile?.ownerId === ownerId(dog) && profile.publicEnabled === true && dog.status !== 'transferred' && dog.transferStatus !== 'pendingClaim'

export function viewerRole(dog, grant, identity) {
  if (hasDogWriteAccess(dog, identity?.uid) && dog.transferStatus !== 'pendingClaim' && dog.status !== 'transferred') return 'owner'
  if (dog.depositStatus === 'received' && identity?.email_verified === true && grantAllowsBuyerRead(grant, dog, identity.email)) return 'buyer'
  return 'public'
}

export function mayReadUpdate(entry, dog, profile, role) {
  if (!entry || entry.deleted === true || !['internal', 'public', 'buyer'].includes(entry.audience)) return false
  if (role === 'owner') return entry.authorUid === ownerId(dog) || ['public', 'buyer'].includes(entry.audience)
  if (entry.authorUid !== ownerId(dog)) return false
  if (role === 'buyer') return ['public', 'buyer'].includes(entry.audience)
  return entry.audience === 'public' && publicSharingLive(dog, profile)
}

export function safeUpdateMedia(item, entry) {
  if (!item || !validId(item.id) || !['photo', 'video'].includes(item.kind)) return false
  if (!validId(entry.authorUid) || !validId(entry.sourceDogId) || typeof item.path !== 'string') return false
  const parts = item.path.split('/')
  return parts.length === 5 && parts[0] === 'dogs' && parts[1] === entry.authorUid && parts[2] === entry.sourceDogId && parts[3] === `${item.kind}s` && !!parts[4] && !parts.some(p => p === '.' || p === '..')
}

export function validateUpdate(body) {
  if (!Array.isArray(body.dogIds) || !body.dogIds.length || body.dogIds.length > 12 || body.dogIds.some(id => !validId(id))) throw new Error('Select between 1 and 12 puppies')
  if (!validId(body.requestId)) throw new Error('A valid update request ID is required')
  if (!['internal', 'public', 'buyer'].includes(body.audience)) throw new Error('Choose who can see this update')
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 3000) throw new Error('Write an update of up to 3000 characters')
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date) throw new Error('Choose a valid update date')
  if (!Array.isArray(body.mediaIds) || body.mediaIds.length > 12 || body.mediaIds.some(id => !validId(id))) throw new Error('Select up to 12 photos or videos')
  return { dogIds: [...new Set(body.dogIds)], text: body.text.trim(), audience: body.audience, date: body.date, mediaIds: [...new Set(body.mediaIds)] }
}
