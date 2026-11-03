import { sendEmailVerification, type User } from 'firebase/auth'
// Delivery state shown on /verify-email. 'sent' only after the email request
// was accepted; 'throttled' when Firebase/our limits refused it (retryAt).
export type Delivery = { status: 'sent' | 'failed' | 'throttled'; attemptedAt: number; retryAt?: number }
const key = (uid: string) => `idogs.verification.${uid}`
export const THROTTLE_RETRY_MS = 60 * 60 * 1000
export function isThrottleError(err: unknown): boolean {
  const m = err instanceof Error ? `${(err as { code?: string }).code || ''} ${err.message}` : String(err || '')
  return /TOO_MANY_ATTEMPTS|too-many-requests|quota-exceeded/i.test(m)
}
export function rememberVerificationDelivery(uid: string, status: Delivery['status'], retryAt?: number): Delivery {
  const d: Delivery = { status, attemptedAt: Date.now(), ...(retryAt ? { retryAt } : {}) }
  try { sessionStorage.setItem(key(uid), JSON.stringify(d)) } catch { /* Email delivery must not depend on browser storage. */ }
  return d
}
export function verificationDelivery(uid?: string): Delivery | null {
  if (!uid) return null
  try {
    const value = JSON.parse(sessionStorage.getItem(key(uid)) || 'null')
    return value && ['sent', 'failed', 'throttled'].includes(value.status) && Date.now() - value.attemptedAt < 86400000 ? value : null
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

/** Sends a verification email: branded first, Firebase default as fallback. Throws idogs/verification-cooldown when our own per-account limit applies. */
export async function deliverVerificationEmail(user: User, continueUrl?: string): Promise<void> {
  const branded = await sendBrandedVerification(user)
  if (branded === 'sent') return
  if (branded === 'rate-limited') throw new Error('idogs/verification-cooldown')
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
  } catch (err) {
    if (isThrottleError(err)) rememberVerificationDelivery(user.uid, 'throttled', Date.now() + THROTTLE_RETRY_MS)
    else rememberVerificationDelivery(user.uid, 'failed')
  }
}
