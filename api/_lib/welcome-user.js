import { createHash } from 'node:crypto'

export const welcomeMessage = {
  subject: 'Welcome to iDogs — their story starts here',
  text: 'Welcome to iDogs!\n\nKeep the moments that matter, from first hello to life at home. Follow a puppy to find their shared photos and updates in Following puppies, or add your own dog to start saving their story.\n\nYou can explore now and add more details when you need them. Private records are only available to people with permission.\n\nOpen iDogs: https://idogs.com.au/app/start\n\nThe iDogs team',
}

// Fixed content and recipient from Firebase Auth; never accept an address or
// message from the caller. A server-only address hash prevents repeated sends
// across retries, concurrent requests, and deleted/re-created accounts.
export function welcomeHandler({ verifyToken, db, apiKey, fetchImpl = fetch, now = Date.now }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    let identity
    try {
      const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error('missing token')
      identity = await verifyToken(token)
    } catch { return res.status(401).json({ error: 'Unauthorized' }) }
    if (!identity.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) return res.status(200).json({ sent: false, reason: 'no_email' })
    // Isolated QA has no email credentials and cannot send real messages.
    if (!apiKey) return res.status(200).json({ sent: false, reason: 'email_unavailable' })
    const key = createHash('sha256').update(identity.email.trim().toLowerCase()).digest('hex')
    const ref = db.collection('accountWelcomeDeliveries').doc(key)
    const timestamp = now()
    try {
      const claim = await db.runTransaction(async tx => {
        const snap = await tx.get(ref), previous = snap.exists ? snap.data() : null
        if (previous?.sentAt || (previous?.leaseUntil || 0) > timestamp) return false
        // Keep provider retries within its 24h idempotency window. Ambiguous
        // delivery is reviewed rather than risking a second welcome later.
        if (previous?.attemptedAt && timestamp - previous.attemptedAt > 23 * 3600000) return false
        tx.set(ref, { attemptedAt: previous?.attemptedAt || timestamp, leaseUntil: timestamp + 60000 }, { merge: true })
        return true
      })
      if (!claim) return res.status(200).json({ sent: false, reason: 'already_requested' })
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `welcome-v1/${key}` },
        body: JSON.stringify({ from: 'iDogs <noreply@idogs.com.au>', to: [identity.email], subject: welcomeMessage.subject, text: welcomeMessage.text }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error('provider rejected')
      await ref.set({ sentAt: now(), leaseUntil: 0 }, { merge: true })
      return res.status(200).json({ sent: true })
    } catch { return res.status(503).json({ sent: false, error: 'Welcome email unavailable' }) }
  }
}
