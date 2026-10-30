import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

// Deliberately emulator-only. Do not wire this prototype to cloud Auth, a real
// SMS transport, or production until its separate operational gate is approved.
export function assertRecoveryQaRuntime(env = process.env) {
  if (env.GCLOUD_PROJECT !== 'demo-idogs-account-mobile'
    || env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9299'
    || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:9280') throw new Error('Recovery requires isolated demo emulators')
}
export class RecoveryError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const invalid = () => new RecoveryError(400, 'Could not verify this request. Check the code or request a new one.')
const throttled = () => new RecoveryError(429, 'Please wait before requesting another code.')
export const RECOVERY_COLLECTION = 'accountRecoveryChallenges'
const LIMITS_COLLECTION = 'accountRecoveryLimits'
export function recoveryPhone(input) {
  if (typeof input !== 'string' || input.length > 40) throw new RecoveryError(400, 'Enter a valid Australian mobile number.')
  let value = input.replace(/[\s()-]/g, '')
  if (/^04\d{8}$/.test(value)) value = '+61' + value.slice(1)
  if (!/^\+614\d{8}$/.test(value)) throw new RecoveryError(400, 'Enter a valid Australian mobile number.')
  return value
}
function validDevice(device) { return typeof device === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(device) }
function blockedDeletion(data) { return data && data.status !== 'cancelled' && data.status !== 'none' }

export function makeRecoveryQaService({ auth, db, sms, secret, env = process.env, now = Date.now, code = () => String(randomInt(1000000)).padStart(6, '0') }) {
  assertRecoveryQaRuntime(env)
  if (sms?.fake !== true || typeof secret !== 'string' || secret.length < 32) throw new Error('Fake transport and a strong test secret are required')
  const digest = value => createHmac('sha256', secret).update(value).digest('hex')
  const limiter = (scope, value, time, window, maximum) => ({ ref: db.collection(LIMITS_COLLECTION).doc(digest(`${scope}|${value}|${Math.floor(time / window)}`)), maximum, resetAt: (Math.floor(time / window) + 1) * window })
  async function userByPhone(phone) {
    try { return await auth.getUserByPhoneNumber(phone) }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error }
  }
  const revision = user => `${user.metadata.creationTime}|${user.tokensValidAfterTime || ''}`
  async function start({ phone: input, device, ip }) {
    const phone = recoveryPhone(input), time = now()
    if (!validDevice(device) || typeof ip !== 'string' || !ip || ip.length > 100) throw new RecoveryError(400, 'Invalid request.')
    const id = randomBytes(32).toString('hex'), otp = code()
    if (!/^\d{6}$/.test(otp)) throw new Error('Invalid test-code generator')
    const limits = [limiter('start-phone', phone, time, 86400000, 5), limiter('start-ip', ip, time, 3600000, 20), limiter('start-device', device, time, 3600000, 10), limiter('start-global', 'all', time, 86400000, 100)]
    const cooldown = db.collection(LIMITS_COLLECTION).doc(digest(`cooldown|${phone}`))
    const ref = db.collection(RECOVERY_COLLECTION).doc(id)
    await db.runTransaction(async tx => {
      const snapshots = await tx.getAll(...limits.map(l => l.ref), cooldown)
      if (snapshots.at(-1).exists && time < snapshots.at(-1).data().nextAt) throw throttled()
      if (limits.some((l, i) => (snapshots[i].data()?.count || 0) >= l.maximum)) throw throttled()
      for (const [i, l] of limits.entries()) tx.set(l.ref, { count: (snapshots[i].data()?.count || 0) + 1, resetAt: l.resetAt })
      tx.set(cooldown, { nextAt: time + 60000 })
    })
    // Reserve limits BEFORE the Auth lookup, so a throttled request cannot
    // keep issuing expensive identity lookups or spending SMS capacity.
    const user = await userByPhone(phone)
    await ref.create({ phone, uid: user?.uid || null, authRevision: user ? revision(user) : null,
      binding: digest(`binding|${device}|${ip}`), mac: digest(`code|${id}|${phone}|${otp}`),
      createdAt: time, expiresAt: time + 300000, attempts: 0, consumed: false,
      delivery: user && !user.disabled ? 'pending' : 'decoy' })
    // Exactly one attempt; ambiguous errors are not retried. The same public
    // receipt is returned for unknown/disabled phones and delivery failures.
    if (user && !user.disabled) {
      try { await sms.send({ phone, code: otp, challenge: id }); await ref.update({ delivery: 'sent' }) }
      catch { await ref.update({ delivery: 'failed' }) }
    }
    return { challenge: id, expiresIn: 300, retryAfter: 60, message: 'If this mobile is linked to an eligible account, a code will be sent.' }
  }
  async function verify({ challenge, code: otp, device, ip }) {
    if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge) || !validDevice(device) || typeof ip !== 'string' || !ip || ip.length > 100 || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) throw invalid()
    const time = now(), ref = db.collection(RECOVERY_COLLECTION).doc(challenge)
    const limits = [limiter('verify-ip', ip, time, 3600000, 120), limiter('verify-device', device, time, 3600000, 60), limiter('verify-global', 'all', time, 3600000, 500)]
    const proof = await db.runTransaction(async tx => {
      const [snapshot, ...counts] = await tx.getAll(ref, ...limits.map(l => l.ref))
      if (limits.some((l, i) => (counts[i].data()?.count || 0) >= l.maximum)) throw throttled()
      for (const [i, l] of limits.entries()) tx.set(l.ref, { count: (counts[i].data()?.count || 0) + 1, resetAt: l.resetAt })
      const data = snapshot.data()
      if (!data || data.consumed || data.expiresAt <= time || data.attempts >= 5) return null
      const matches = timingSafeEqual(Buffer.from(data.mac, 'hex'), Buffer.from(digest(`code|${challenge}|${data.phone}|${otp}`), 'hex'))
      const accepted = matches && data.binding === digest(`binding|${device}|${ip}`) && data.delivery === 'sent' && !!data.uid
      // Return failure AFTER committing the attempt; throwing inside this
      // transaction would roll back brute-force accounting.
      tx.update(ref, { attempts: data.attempts + 1, consumed: accepted || data.attempts + 1 >= 5 })
      return accepted ? data : null
    })
    if (!proof) throw invalid()
    // Consume before looking up email: at most one concurrent request can
    // disclose it. Recheck the current mapping and lifecycle after OTP proof.
    const user = await userByPhone(proof.phone)
    if (!user || user.uid !== proof.uid || user.disabled || revision(user) !== proof.authRevision) throw invalid()
    const deletion = await db.collection('accountDeletionRequests').doc(user.uid).get()
    if (blockedDeletion(deletion.data())) throw invalid()
    if (!user.email || !user.emailVerified) return { status: 'incomplete', message: 'This account still needs a verified email and password. Use the existing mobile account-completion option; do not create another account.' }
    return { status: 'found', email: user.email }
  }
  return { start, verify }
}

export function makeRecoveryQaHandler(service) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    try {
      if (typeof req.body === 'string' && Buffer.byteLength(req.body) > 2048) throw new RecoveryError(413, 'Request too large.')
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new RecoveryError(400, 'Invalid request.')
      const allowed = body.action === 'start' ? ['action', 'phone', 'device'] : body.action === 'verify' ? ['action', 'challenge', 'code', 'device'] : []
      if (!allowed.length || Object.keys(body).some(k => !allowed.includes(k))) throw new RecoveryError(400, 'Invalid request.')
      // Local QA server supplies socket-derived IP; never trust a body/header IP.
      const args = { ...body, ip: req.socket.remoteAddress }
      const result = body.action === 'start' ? await service.start(args) : body.action === 'verify' ? await service.verify(args) : null
      if (!result) throw new RecoveryError(400, 'Invalid request.')
      return res.status(200).json(result)
    } catch (error) {
      const status = error instanceof RecoveryError ? error.status : error instanceof SyntaxError ? 400 : 503
      return res.status(status).json({ error: error instanceof RecoveryError ? error.message : status === 400 ? 'Invalid request.' : 'Account recovery is temporarily unavailable.' })
    }
  }
}
