import { reload, updatePassword, type User } from 'firebase/auth'
import { auth } from './firebase'

// Production-safe "add email & password sign-in" for an existing account
// (typically a customer who signed up with SMS only).
//
// Design (Owner directive 6564223316 — "existing phone user links VERIFIED
// email, sets password"):
//   1. The email must already be on THIS account and VERIFIED. Emails reach a
//      phone account only through /verify-email (verifyBeforeUpdateEmail), so
//      the address is applied only after its owner clicks the link. Firebase
//      refuses there if the address belongs to another account.
//   2. A password is then added with updatePassword() on the SAME Firebase
//      user. The UID — and every dog, document, QR passport and Stripe/Plus
//      entitlement keyed on it — is unchanged. Phone sign-in keeps working.
// It never creates, switches, merges or links a second identity, and never
// attaches an unverified address (no email squatting, no typo lock-out).

// Kill switch: set VITE_IDOGS_EMAIL_PASSWORD_LINK=0 to hide the feature.
export function emailPasswordLinkEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_IDOGS_EMAIL_PASSWORD_LINK !== '0'
}

export type LinkableAccount = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>

/** True when this account cannot yet sign in with email + password. */
export function needsPasswordSignIn(user: Pick<User, 'providerData'> | null | undefined): boolean {
  if (!user || !Array.isArray(user.providerData) || user.providerData.length === 0) return false
  return !user.providerData.some(p => p?.providerId === 'password')
}

export type EmailPasswordStep = 'hidden' | 'verify-email' | 'set-password'

/** Which step of the flow the account is at. */
export function emailPasswordStep(user: LinkableAccount | null | undefined): EmailPasswordStep {
  if (!user || !needsPasswordSignIn(user)) return 'hidden'
  return user.email && user.emailVerified ? 'set-password' : 'verify-email'
}

export function validateNewPassword(password: string, confirmPassword: string): void {
  if (password.length < 8 || password.length > 128) throw new Error('Choose a password of 8–128 characters.')
  if (password !== confirmPassword) throw new Error('The passwords do not match.')
}

export type EmailPasswordLinkResult = { uid: string; email: string }

export async function addPasswordToVerifiedEmail(
  user: User,
  password: string,
  confirmPassword: string,
): Promise<EmailPasswordLinkResult> {
  if (!emailPasswordLinkEnabled()) throw new Error('Email and password sign-in can’t be added right now.')
  const uid = user.uid
  if (auth.currentUser?.uid !== uid) throw new Error('session-changed')
  await reload(user)
  if (auth.currentUser?.uid !== uid) throw new Error('session-changed')
  if (!needsPasswordSignIn(user)) throw new Error('auth/provider-already-linked')
  if (!user.email || !user.emailVerified) throw new Error('email-not-verified')
  validateNewPassword(password, confirmPassword)
  await updatePassword(user, password)
  await reload(user)
  const after = auth.currentUser
  if (!after || after.uid !== uid) throw new Error('session-changed')
  return { uid, email: after.email || user.email }
}

export function emailPasswordLinkErrorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err || '')
  if (/email-not-verified/.test(m)) return 'Verify your email address first, then come back here to set a password.'
  if (/email-already-in-use|credential-already-in-use|account-exists-with-different-credential/.test(m)) {
    return 'This email already belongs to a different iDogs account. Use another email, or sign in to that account. No accounts, dogs or subscriptions have been merged or moved.'
  }
  if (/provider-already-linked/.test(m)) return 'This account can already sign in with email and password. Use Forgot password if you need a new one.'
  if (/requires-recent-login|user-token-expired|session-changed|invalid-user-token/.test(m)) {
    return 'For your security, sign out and sign in again with your mobile number, then return to Settings to finish.'
  }
  if (/user-disabled/.test(m)) return 'This account is disabled. Contact iDogs support.'
  if (/weak-password/.test(m)) return 'Choose a stronger password (at least 8 characters, not easy to guess).'
  if (/too-many-requests/.test(m)) return 'Too many attempts. Please wait a few minutes and try again.'
  if (/network-request-failed/.test(m)) return 'No connection. Check your internet and try again.'
  if (m && !m.startsWith('Firebase:') && !m.startsWith('auth/')) return m
  return 'Could not add email sign-in. Please try again shortly.'
}
