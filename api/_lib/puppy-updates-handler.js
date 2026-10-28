import { createHash } from 'crypto'
import { ApiError, parseJsonBody } from './http-helpers.js'
import { checkRateLimit, getClientIp, hashClientKey } from './rate-limit.js'
import { validId, ownerId, canPublish, publicSharingLive, viewerRole, mayReadUpdate, safeUpdateMedia, validateUpdate } from './puppy-updates-policy.js'

export function createPuppyUpdatesHandler({ db, verifyToken, sign, publicBase = '', timestamp = () => new Date().toISOString() }) {
  const profileRef = id => db.collection('puppyProfiles').doc(id)
  const entriesRef = id => profileRef(id).collection('updates')
  const followRef = (uid, id) => db.collection('puppyFollowers').doc(uid).collection('dogs').doc(id)
  async function assertSameAccess(dog, role, profile, identity) {
    const [freshDog, freshProfile, freshGrant] = await Promise.all([db.collection('dogs').doc(dog.id).get(), profileRef(dog.id).get(), db.collection('dogPrivateAccess').doc(dog.id).get()])
    const current = { ...freshDog.data(), id: dog.id }
    if (!freshDog.exists || ownerId(current) !== ownerId(dog) || viewerRole(current, freshGrant.data(), identity) !== role || (role === 'public' && publicSharingLive(current, freshProfile.data()) !== publicSharingLive(dog, profile))) {
      throw new ApiError(409, 'Access changed while loading. Refresh updates.')
    }
  }
  async function loadDog(body) {
    if (body.passportId) {
      if (!validId(body.passportId)) throw new ApiError(400, 'Invalid puppy link')
      const found = await db.collection('dogs').where('passportId', '==', body.passportId).limit(1).get()
      if (found.empty) throw new ApiError(404, 'Puppy not found')
      return { ...found.docs[0].data(), id: found.docs[0].id }
    }
    if (!validId(body.dogId)) throw new ApiError(400, 'Invalid puppy link')
    const snap = await db.collection('dogs').doc(body.dogId).get()
    if (!snap.exists) throw new ApiError(404, 'Puppy not found')
    return { ...snap.data(), id: snap.id }
  }
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!['POST', 'GET'].includes(req.method)) throw new ApiError(405, 'Method not allowed')
    const body = req.method === 'GET' ? req.query : parseJsonBody(req)
    const action = body.action || 'view'
    if (req.method === 'GET' && !['view', 'media'].includes(action)) throw new ApiError(405, 'Use POST')
    const raw = (req.headers.authorization || '').replace(/^Bearer /, '')
    let identity = null
    if (raw) {
      try { identity = await verifyToken(raw) } catch { throw new ApiError(401, 'Please sign in again') }
    }
    if (!identity && !['view', 'media'].includes(action)) throw new ApiError(401, 'Please sign in')
    if (!identity && !body.passportId) throw new ApiError(400, 'A puppy QR link is required')
    if (!identity) {
      const rate = checkRateLimit(hashClientKey(getClientIp(req)))
      if (!rate.allowed) { res.setHeader('Retry-After', String(rate.retryAfterSeconds)); throw new ApiError(429, 'Please try again shortly') }
    }
    if (action === 'list') {
      const follows = await followRef(identity.uid, '_').parent.limit(100).get()
      const puppies = []
      for (const saved of follows.docs) {
        const dogSnap = await db.collection('dogs').doc(saved.id).get()
        if (!dogSnap.exists) continue
        const dog = dogSnap.data()
        if (!validId(dog.passportId)) continue
        puppies.push({ passportId: dog.passportId, name: dog.name || 'Puppy', breed: dog.breed || '', followedAt: saved.data().followedAt || null })
      }
      return res.status(200).json({ puppies })
    }
    if (action === 'create') {
      let input
      try { input = validateUpdate(body) } catch (e) { throw new ApiError(400, e.message) }
      const updateId = createHash('sha256').update(`${identity.uid}:${body.requestId}`).digest('hex')
      const result = await db.runTransaction(async tx => {
        const dogs = await Promise.all(input.dogIds.map(id => tx.get(db.collection('dogs').doc(id))))
        if (dogs.some(s => !s.exists || !canPublish(s.data(), identity.uid))) throw new ApiError(403, 'You can only update puppies you currently manage')
        const refs = input.dogIds.map(id => entriesRef(id).doc(updateId))
        const existing = await Promise.all(refs.map(ref => tx.get(ref)))
        // A retry returns the original write, never publishes a second update.
        if (existing.every(s => s.exists)) return { updateId, repeated: true }
        if (existing.some(s => s.exists)) throw new ApiError(409, 'Update request already used; refresh and retry')
        const source = dogs[0].data()
        const candidates = [...(source.photos || []).map(m => ({ ...m, kind: 'photo' })), ...(source.videos || []).map(m => ({ ...m, kind: 'video' }))]
        const uploaded = await Promise.all(input.mediaIds.map(id => tx.get(profileRef(input.dogIds[0]).collection('media').doc(id))))
        const media = input.mediaIds.map((id, index) => candidates.find(m => m.id === id) || (uploaded[index].exists && uploaded[index].data().authorUid === identity.uid ? { ...uploaded[index].data(), id } : null))
        const entry = { authorUid: identity.uid, sourceDogId: input.dogIds[0] }
        if (media.some(m => !safeUpdateMedia(m, entry))) throw new ApiError(400, 'Some media is unavailable; select media uploaded by your account')
        const data = { ...entry, text: input.text, date: input.date, audience: input.audience, media: media.map(({ id, path, kind }) => ({ id, path, kind })), createdAt: timestamp(), deleted: false }
        refs.forEach(ref => tx.create(ref, data))
        return { updateId, repeated: false }
      })
      return res.status(200).json(result)
    }
    const dog = await loadDog(body)
    const [profileSnap, grantSnap] = await Promise.all([profileRef(dog.id).get(), db.collection('dogPrivateAccess').doc(dog.id).get()])
    const profile = profileSnap.data() || {}
    const role = viewerRole(dog, grantSnap.data(), identity)
    if (action === 'gallery') {
      if (role !== 'owner') throw new ApiError(403, 'Only the current owner can select story media')
      const uploaded = await profileRef(dog.id).collection('media').orderBy('createdAt', 'desc').limit(100).get()
      const entry = { authorUid: identity.uid, sourceDogId: dog.id }
      const media = [...uploaded.docs.map(snap => ({ ...snap.data(), id: snap.id })), ...(dog.photos || []).map(m => ({ ...m, kind: 'photo' })), ...(dog.videos || []).map(m => ({ ...m, kind: 'video' }))].filter(m => safeUpdateMedia(m, entry))
      const signed = await sign(media, 15 * 60 * 1000)
      await assertSameAccess(dog, role, profile, identity)
      return res.status(200).json({ media: signed.map(m => ({ ...m, kind: media.find(item => item.id === m.id).kind })) })
    }
    if (action === 'follow' || action === 'unfollow') {
      if (identity.email_verified !== true) throw new ApiError(403, 'Verify your email before following a puppy')
      if (action === 'follow') {
        await db.runTransaction(async tx => {
          const ref = followRef(identity.uid, dog.id)
          const saved = await tx.get(ref)
          if (!saved.exists) {
            const follows = await tx.get(ref.parent.limit(100))
            if (follows.size >= 100) throw new ApiError(409, 'You can follow up to 100 puppies')
            tx.set(ref, { followedAt: new Date().toISOString() })
          }
        })
      } else await followRef(identity.uid, dog.id).delete()
      return res.status(200).json({ following: action === 'follow' })
    }
    if (action === 'settings') {
      if (typeof body.publicEnabled !== 'boolean') throw new ApiError(400, 'Choose a sharing setting')
      await db.runTransaction(async tx => {
        const fresh = await tx.get(db.collection('dogs').doc(dog.id))
        if (!fresh.exists || !canPublish(fresh.data(), identity.uid)) throw new ApiError(403, 'Only the current owner can change sharing')
        tx.set(profileRef(dog.id), { ownerId: identity.uid, publicEnabled: body.publicEnabled, updatedAt: timestamp() }, { merge: true })
      })
      return res.status(200).json({ publicEnabled: body.publicEnabled })
    }
    if (action === 'edit') {
      if (!validId(body.updateId)) throw new ApiError(400, 'Invalid update')
      let input
      try { input = validateUpdate({ ...body, dogIds: [dog.id], requestId: 'edit' }) } catch (e) { throw new ApiError(400, e.message) }
      await db.runTransaction(async tx => {
        const fresh = await tx.get(db.collection('dogs').doc(dog.id))
        const ref = entriesRef(dog.id).doc(body.updateId)
        const saved = await tx.get(ref)
        const entry = saved.data()
        if (!fresh.exists || !canPublish(fresh.data(), identity.uid) || !saved.exists || entry.deleted || entry.authorUid !== identity.uid) throw new ApiError(403, 'Only the author who currently manages this puppy can edit this update')
        const uploaded = await Promise.all(input.mediaIds.map(id => tx.get(profileRef(dog.id).collection('media').doc(id))))
        const candidates = [...(fresh.data().photos || []).map(m => ({ ...m, kind: 'photo' })), ...(fresh.data().videos || []).map(m => ({ ...m, kind: 'video' }))]
        // Keep existing group media from its original source; replacement media
        // must belong to the current puppy and author. Never trust client paths.
        const media = input.mediaIds.map((id, index) => {
          const old = entry.media?.find(m => m.id === id)
          if (old && safeUpdateMedia(old, entry)) return old
          const candidate = candidates.find(m => m.id === id) || (uploaded[index].exists && uploaded[index].data().authorUid === identity.uid ? { ...uploaded[index].data(), id } : null)
          return safeUpdateMedia(candidate, { authorUid: identity.uid, sourceDogId: dog.id }) ? { ...candidate, sourceDogId: dog.id } : null
        })
        if (media.some(m => !m)) throw new ApiError(400, 'Some media is unavailable; choose your own uploaded media')
        tx.update(ref, { text: input.text, date: input.date, audience: input.audience, media: media.map(({ id, path, kind, sourceDogId }) => ({ id, path, kind, ...(sourceDogId ? { sourceDogId } : {}) })), updatedAt: timestamp() })
      })
      return res.status(200).json({ success: true })
    }
    if (action === 'visibility' || action === 'delete') {
      if (!validId(body.updateId) || (action === 'visibility' && !['internal', 'public', 'buyer'].includes(body.audience))) throw new ApiError(400, 'Invalid update')
      await db.runTransaction(async tx => {
        const fresh = await tx.get(db.collection('dogs').doc(dog.id))
        const ref = entriesRef(dog.id).doc(body.updateId)
        const entry = await tx.get(ref)
        if (!fresh.exists || !canPublish(fresh.data(), identity.uid) || !entry.exists) throw new ApiError(403, 'Only the current owner can manage updates')
        // New owners may remove inherited shared entries, but never reveal
        // a former owner's internal notes or republish under their identity.
        if (action === 'visibility' && entry.data().authorUid !== identity.uid) throw new ApiError(403, 'Inherited updates can be removed, not republished')
        if (entry.data().authorUid !== identity.uid && !['public', 'buyer'].includes(entry.data().audience)) throw new ApiError(403, 'Former owner private notes cannot be changed')
        tx.update(ref, action === 'delete' ? { deleted: true, updatedAt: timestamp() } : { audience: body.audience, updatedAt: timestamp() })
      })
      return res.status(200).json({ success: true })
    }
    if (action === 'media') {
      if (!validId(body.updateId) || !validId(body.mediaId)) throw new ApiError(404, 'Media not found')
      const snap = await entriesRef(dog.id).doc(body.updateId).get()
      const entry = snap.data()
      // Public media URLs never accept query-string credentials.
      if (!mayReadUpdate(entry, dog, profile, role)) throw new ApiError(404, 'Media not found')
      const item = entry.media?.find(m => m.id === body.mediaId)
      if (!safeUpdateMedia(item, entry)) throw new ApiError(404, 'Media not found')
      const signed = await sign([item], 60 * 1000)
      if (!signed.length) throw new ApiError(404, 'Media not found')
      await assertSameAccess(dog, role, profile, identity)
      return res.redirect(302, signed[0].url)
    }
    if (action !== 'view') throw new ApiError(400, 'Unknown action')
    let page = entriesRef(dog.id).orderBy('createdAt', 'desc')
    if (body.cursor) {
      if (!validId(body.cursor)) throw new ApiError(400, 'Invalid page')
      const cursor = await entriesRef(dog.id).doc(body.cursor).get()
      if (!cursor.exists) throw new ApiError(400, 'This page is unavailable; refresh updates')
      page = page.startAfter(cursor)
    }
    const snapshot = await page.limit(25).get()
    const updates = []
    for (const snap of snapshot.docs) {
      const entry = snap.data()
      if (!mayReadUpdate(entry, dog, profile, role)) continue
      const media = (entry.media || []).filter(m => safeUpdateMedia(m, entry))
      const items = role === 'public' ? media.map(m => ({ id: m.id, kind: m.kind, url: `${publicBase}/api/puppy-updates?action=media&passportId=${encodeURIComponent(dog.passportId)}&updateId=${snap.id}&mediaId=${m.id}` }))
        : (await sign(media, 5 * 60 * 1000)).map(m => ({ ...m, kind: media.find(item => item.id === m.id).kind }))
      updates.push({ id: snap.id, text: entry.text, date: entry.date, audience: entry.audience, inherited: entry.authorUid !== ownerId(dog), media: items })
    }
    const saved = identity ? await followRef(identity.uid, dog.id).get() : null
    await assertSameAccess(dog, role, profile, identity)
    return res.status(200).json({ dog: { name: dog.name || 'Puppy', breed: dog.breed || '', passportId: dog.passportId }, role, following: saved?.exists || false, publicEnabled: publicSharingLive(dog, profile), updates, nextCursor: snapshot.docs.length === 25 ? snapshot.docs.at(-1).id : null, ...(role === 'owner' ? { dogId: dog.id } : {}) })
  }
}

