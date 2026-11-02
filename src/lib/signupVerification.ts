import { sendEmailVerification, type User } from 'firebase/auth'
type Delivery = { status: 'sent' | 'failed'; attemptedAt: number }
const key = (uid: string) => `idogs.verification.${uid}`
export function rememberVerificationDelivery(uid: string, status: Delivery['status']) {
  try { sessionStorage.setItem(key(uid), JSON.stringify({ status, attemptedAt: Date.now() })) } catch { /* Email delivery must not depend on browser storage. */ }
}
export function verificationDelivery(uid?: string): Delivery | null {
  if (!uid) return null
  try {
    const value = JSON.parse(sessionStorage.getItem(key(uid)) || 'null')
    return value && ['sent', 'failed'].includes(value.status) && Date.now() - value.attemptedAt < 86400000 ? value : null
  } catch { return null }
}

// Kill switch: VITE_IDOGS_BRANDED_VERIFICATION=0 returns to Firebase's default email only.
export function brandedVerificationEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_IDOGS_BRANDED_VERIFICATION !== '0'
}

// iDogs-branded verification email (Resend, noreply@idogs.com.au) with a
// Firebase-generated link. 'sent' | 'rate-limited' | 'fallback'.
export async function sendBrandedVerification(user: User, fetchImpl: typeof fetch = fetch): Promise<'sent' | 'rate-limited' | 'fallback'> {
  if (!brandedVerificationEnabled()) return 'fallback'
  try {
    const token = await user.getIdToken()
    const res = await fetchImpl('/api/send-verification-email', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 429) return 'rate-limited'
    const body = await res.json().catch(() => ({}))
    return res.ok && body?.sent === true ? 'sent' : 'fallback'
  } catch { return 'fallback' }
}

/** Sends a verification email: branded first, Firebase default as fallback. Throws auth/too-many-requests when rate-limited. */
export async function deliverVerificationEmail(user: User, continueUrl?: string): Promise<void> {
  const branded = await sendBrandedVerification(user)
  if (branded === 'sent') return
  if (branded === 'rate-limited') throw new Error('Firebase: Error (auth/too-many-requests).')
  if (!continueUrl) return sendEmailVerification(user)
  try { await sendEmailVerification(user, { url: continueUrl }) }
  catch (err) {
    // Unauthorized continue domain (new Preview host): still send the email.
    if (!/unauthorized-continue-uri|invalid-continue-uri|missing-continue-uri/.test(String((err as { code?: string })?.code || (err as Error)?.message))) throw err
    await sendEmailVerification(user)
  }
}

// A delivery outage must never delete a successfully created account.
export async function sendInitialVerification(user: User): Promise<void> {
  if (!user.email || user.emailVerified) return
  try {
    const url = typeof window === 'undefined' ? undefined : `${window.location.origin}/verify-email`
    await deliverVerificationEmail(user, url)
    rememberVerificationDelivery(user.uid, 'sent')
  } catch { rememberVerificationDelivery(user.uid, 'failed') }
}
