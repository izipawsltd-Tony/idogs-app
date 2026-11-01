import { EmailAuthProvider, linkWithCredential, reload, sendEmailVerification, updatePassword, type User } from 'firebase/auth'
import { auth } from './firebase'

// Production-safe "add email & password sign-in" for an existing account
// (typically a customer who signed up with SMS only). It adds a password
// credential to the SAME Firebase identity, so the UID — and therefore every
// dog, document, QR passport and Stripe/Plus entitlement keyed on it — is
// unchanged. It never creates, switches or merges accounts: Firebase rejects
// an email that already belongs to a different UID, and we surface that
// without retrying under another identity.

// Kill switch: set VITE_IDOGS_EMAIL_PASSWORD_LINK=0 to hide the feature.
export function emailPasswordLinkEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_IDOGS_EMAIL_PASSWORD_LINK !== '0'
}

export type LinkableAccount = Pick<User, 'uid' | 'email' | 'providerData'>

/** True when this account cannot yet sign in with email + password. */
export function needsPasswordSignIn(user: LinkableAccount | null | undefined): boolean {
  if (!user || !Array.isArray(user.providerData) || user.providerData.length === 0) return false
  return !user.providerData.some(p => p?.providerId === 'password')
}

export function validateEmailPasswordLink(
  user: LinkableAccount,
  requestedEmail: string,
  password: string,
  confirmPassword: string,
): { email: string } {
  // An account that already has an email keeps it: this flow adds a
  // password for that email, it never changes the address.
  const email = (user.email || requestedEmail).trim().toLowerCase()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }
  if (password.length < 8 || password.length > 128) throw new Error('Choose a password of 8–128 characters.')
  if (password !== confirmPassword) throw new Error('The passwords do not match.')
  return { email }
}

export type EmailPasswordLinkResult = { uid: string; email: string; emailVerified: boolean; verificationSent: boolean }

export async function linkEmailPasswordToCurrentAccount(
  user: User,
  requestedEmail: string,
  password: string,
  confirmPassword: string,
): Promise<EmailPasswordLinkResult> {
  if (!emailPasswordLinkEnabled()) throw new Error('Email and password sign-in can’t be added right now.')
  const uid = user.uid
  if (auth.currentUser?.uid !== uid) throw new Error('session-changed')
  await reload(user)
  if (auth.currentUser?.uid !== uid) throw new Error('session-changed')
  if (!needsPasswordSignIn(user)) throw new Error('auth/provider-already-linked')
  const { email } = validateEmailPasswordLink(user, requestedEmail, password, confirmPassword)
  let linkedUser: User
  if (user.email) {
    // The account already owns this email (e.g. added and verified through
    // the verification page). Firebase rejects linking an email credential
    // for an address the account already holds (auth/email-already-in-use),
    // so set a password on the SAME account instead — this enables
    // email/password sign-in for that email without touching the address.
    await updatePassword(user, password)
    await reload(user)
    linkedUser = auth.currentUser as User
  } else {
    const result = await linkWithCredential(user, EmailAuthProvider.credential(email, password))
    linkedUser = result.user
  }
  if (!linkedUser || linkedUser.uid !== uid || auth.currentUser?.uid !== uid) throw new Error('session-changed')
  let verificationSent = false
  if (!linkedUser.emailVerified) {
    // Delivery can fail after the credential was linked; never imply the
    // link failed or invite a second link attempt because of it.
    try { await sendEmailVerification(linkedUser); verificationSent = true } catch { verificationSent = false }
  }
  return { uid, email: linkedUser.email || email, emailVerified: linkedUser.emailVerified, verificationSent }
}

export function emailPasswordLinkErrorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err || '')
  if (/email-already-in-use|credential-already-in-use|account-exists-with-different-credential/.test(m)) {
    return 'This email already belongs to a different iDogs account. Use another email, or sign in to that account. No accounts, dogs or subscriptions have been merged or moved.'
  }
  if (/provider-already-linked/.test(m)) return 'This account can already sign in with email and password. Use Forgot password if you need a new one.'
  if (/requires-recent-login|user-token-expired|session-changed/.test(m)) {
    return 'For your security, sign out and sign in again with your mobile number, then return to Settings to finish.'
  }
  if (/weak-password/.test(m)) return 'Choose a stronger password (at least 8 characters, not easy to guess).'
  if (/invalid-email/.test(m)) return 'Enter a valid email address.'
  if (/too-many-requests/.test(m)) return 'Too many attempts. Please wait a few minutes and try again.'
  if (/network-request-failed/.test(m)) return 'No connection. Check your internet and try again.'
  if (m && !m.startsWith('Firebase:') && !m.startsWith('auth/')) return m
  return 'Could not add email sign-in. Please try again shortly.'
}
