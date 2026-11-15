import { hasDogWriteAccess, canAddDogRecord } from './dog-access.js'
import { grantAllowsBuyerRead } from './private-dog-access.js'

export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export const ownerId = dog => Object.hasOwn(dog || {}, 'currentOwnerId') ? dog.currentOwnerId : dog?.tenantId
export const canPublish = (dog, uid) => canAddDogRecord(dog, uid) && dog.status !== 'transferred' && dog.transferStatus !== 'pendingClaim'
export const publicSharingLive = (dog, profile) => !!ownerId(dog) && profile?.ownerId === ownerId(dog) && profile.publicEnabled === true && dog.status !== 'transferred' && dog.transferStatus !== 'pendingClaim'

export function publicMediaBase(env) {
  // Production's immutable Vercel URL is SSO-protected even though the
  // customer-facing domain is public. Never send public media there.
  if (env.FIREBASE_PROJECT_ID === 'idogs-app') return 'https://idogs.com.au'
  if (env.FIREBASE_PROJECT_ID === 'idogs-app-staging' && env.IDOGS_NATIVE_QA_BACKEND === '1') return 'https://idogs-puppy-journey-qa-izipawsltd-tonys-projects.vercel.app'
  return /^[a-z0-9.-]+\.vercel\.app$/.test(env.VERCEL_URL || '') ? `https://${env.VERCEL_URL}` : ''
}

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
  const sourceDogId = item.sourceDogId || entry.sourceDogId
  if (!validId(entry.authorUid) || !validId(sourceDogId) || typeof item.path !== 'string') return false
  const parts = item.path.split('/')
  return parts.length === 5 && parts[0] === 'dogs' && parts[1] === entry.authorUid && parts[2] === sourceDogId && parts[3] === `${item.kind}s` && !!parts[4] && !parts.some(p => p === '.' || p === '..')
}

export function validateUpdate(body) {
  if (!Array.isArray(body.dogIds) || !body.dogIds.length || body.dogIds.length > 12 || body.dogIds.some(id => !validId(id))) throw new Error('Select between 1 and 12 puppies')
  if (!validId(body.requestId)) throw new Error('A valid update request ID is required')
  if (!['internal', 'public', 'buyer'].includes(body.audience)) throw new Error('Choose who can see this update')
  if (typeof body.text !== 'string' || body.text.length > 3000) throw new Error('Write an update of up to 3000 characters')
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date) throw new Error('Choose a valid update date')
  if (!Array.isArray(body.mediaIds) || body.mediaIds.length > 12 || body.mediaIds.some(id => !validId(id))) throw new Error('Select up to 12 photos or videos')
  if (!body.text.trim() && body.mediaIds.length === 0) throw new Error('Add a photo/video or write a memory')
  return { dogIds: [...new Set(body.dogIds)], text: body.text.trim(), audience: body.audience, date: body.date, mediaIds: [...new Set(body.mediaIds)] }
}
