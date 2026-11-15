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
// A delivery outage must never delete a successfully created account.
export async function sendInitialVerification(user: User): Promise<void> {
  if (!user.email || user.emailVerified) return
  try {
    const settings = typeof window === 'undefined' ? undefined : { url: `${window.location.origin}/verify-email` }
    try {
      await sendEmailVerification(user, settings)
    } catch (err) {
      // A host that is not an authorized Firebase domain (e.g. a per-deployment
      // Preview URL) rejects the continue URL; the email itself still works
      // without one, so retry once without it instead of failing the signup email.
      const code = (err as { code?: string })?.code || ''
      if (!settings || !/unauthorized-continue-uri|invalid-continue-uri|unauthorized-domain/.test(code)) throw err
      await sendEmailVerification(user)
    }
    rememberVerificationDelivery(user.uid, 'sent')
  } catch { rememberVerificationDelivery(user.uid, 'failed') }
}
