import {
  EmailAuthProvider, isSignInWithEmailLink, linkWithCredential, reload, sendSignInLinkToEmail, updatePassword, type User,
} from 'firebase/auth'
import { auth } from './firebase'

// Production-safe "add email & password sign-in" for an existing account
// (typically a customer who signed up with SMS only).
//
// Owner directive 6564223316: "existing phone user links VERIFIED email,
// sets password"; no duplicate users, no data loss.
//
//   A. Account has NO email: we email a one-time sign-in link to the address.
//      Opening it links the address with EmailAuthProvider.credentialWithLink
//      — Firebase only accepts that credential from the link it sent, so the
//      address is attached already VERIFIED, to the SAME uid. An address that
//      belongs to another account is refused (no merge, no move).
//      (verifyBeforeUpdateEmail cannot be used here: Firebase requires an
//      existing email for it — auth/missing-email, reproduced in the Auth
//      emulator.) Needs Firebase "Email link (passwordless sign-in)" enabled.
//   B. Account has an UNVERIFIED email: verify it first (/verify-email).
//   C. Account has a VERIFIED email: updatePassword() on the same uid.
// Every dog, document, QR passport and Stripe/Plus entitlement is keyed on
// the uid, which never changes. Phone sign-in keeps working.

// Kill switch: set VITE_IDOGS_EMAIL_PASSWORD_LINK=0 to hide the feature.
export function emailPasswordLinkEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_IDOGS_EMAIL_PASSWORD_LINK !== '0'
}

export const PENDING_EMAIL_LINK_KEY = 'idogs-add-email-link-v1'
const PENDING_MAX_AGE_MS = 60 * 60 * 1000

export type LinkableAccount = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>

/** True when this account cannot yet sign in with email + password. */
export function needsPasswordSignIn(user: Pick<User, 'providerData'> | null | undefined): boolean {
  if (!user || !Array.isArray(user.providerData) || user.providerData.length === 0) return false
  return !user.providerData.some(p => p?.providerId === 'password')
}

export type EmailPasswordStep = 'hidden' | 'add-email' | 'verify-email' | 'set-password'

/** Which step of the flow the account is at. */
export function emailPasswordStep(user: LinkableAccount | null | undefined): EmailPasswordStep {
  if (!user || !needsPasswordSignIn(user)) return 'hidden'
  if (!user.email) return 'add-email'
  return user.emailVerified ? 'set-password' : 'verify-email'
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  return email
}

export function validateNewPassword(password: string, confirmPassword: string): void {
  if (password.length < 8 || password.length > 128) throw new Error('Choose a password of 8–128 characters.')
  if (password !== confirmPassword) throw new Error('The passwords do not match.')
}

function assertSameSession(uid: string) {
  if (auth.currentUser?.uid !== uid) throw new Error('session-changed')
}

type Pending = { uid: string; email: string; createdAt: number }
function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_EMAIL_LINK_KEY) || 'null') as Pending | null
    return p && typeof p.uid === 'string' && typeof p.email === 'string' && Date.now() - p.createdAt < PENDING_MAX_AGE_MS ? p : null
  } catch { return null }
}
function clearPending() { try { localStorage.removeItem(PENDING_EMAIL_LINK_KEY) } catch { /* optional */ } }

/** Step A1: email a one-time link that proves ownership of the address. */
export async function sendAddEmailLink(user: User, requestedEmail: string, origin: string): Promise<{ email: string }> {
  if (!emailPasswordLinkEnabled()) throw new Error('Email and password sign-in can’t be added right now.')
  const uid = user.uid
  assertSameSession(uid)
  if (user.email) throw new Error('This account already has an email address.')
  const email = normalizeEmail(requestedEmail)
  await sendSignInLinkToEmail(auth, email, { url: `${origin}/app/settings?addEmail=1`, handleCodeInApp: true })
  try { localStorage.setItem(PENDING_EMAIL_LINK_KEY, JSON.stringify({ uid, email, createdAt: Date.now() } satisfies Pending)) } catch { /* same-device only */ }
  return { email }
}

export function isAddEmailLink(href: string): boolean {
  try { return new URL(href).searchParams.get('addEmail') === '1' && isSignInWithEmailLink(auth, href) } catch { return false }
}

/** Step A2: link the verified address to the SAME uid from the emailed link. */
export async function completeAddEmailLink(user: User, href: string): Promise<{ uid: string; email: string }> {
  const uid = user.uid
  assertSameSession(uid)
  if (!isSignInWithEmailLink(auth, href)) throw new Error('invalid-action-code')
  const pending = readPending()
  if (!pending) throw new Error('email-link-other-device')
  if (pending.uid !== uid) { clearPending(); throw new Error('session-changed') }
  if (user.email) { clearPending(); throw new Error('This account already has an email address.') }
  const result = await linkWithCredential(user, EmailAuthProvider.credentialWithLink(pending.email, href))
  clearPending()
  if (result.user.uid !== uid) throw new Error('session-changed')
  await reload(result.user)
  assertSameSession(uid)
  return { uid, email: result.user.email || pending.email }
}

/** Step C: add a password for the account's VERIFIED email (same uid). */
export async function addPasswordToVerifiedEmail(
  user: User,
  password: string,
  confirmPassword: string,
  { allowEmailLinkProvider = false }: { allowEmailLinkProvider?: boolean } = {},
): Promise<{ uid: string; email: string }> {
  if (!emailPasswordLinkEnabled()) throw new Error('Email and password sign-in can’t be added right now.')
  const uid = user.uid
  assertSameSession(uid)
  await reload(user)
  assertSameSession(uid)
  // Right after step A2 the email-link credential shows as provider
  // 'password' (Firebase groups email link under it) but has no password yet.
  if (!allowEmailLinkProvider && !needsPasswordSignIn(user)) throw new Error('auth/provider-already-linked')
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
  if (/email-already-in-use|credential-already-in-use|account-exists-with-different-credential|email-exists/.test(m)) {
    return 'This email already belongs to a different iDogs account. Use another email, or sign in to that account. No accounts, dogs or subscriptions have been merged or moved.'
  }
  if (/email-link-other-device/.test(m)) return 'Open the email link on the same phone or computer where you requested it, while signed in. Or request a new link here.'
  if (/invalid-action-code|expired-action-code/.test(m)) return 'This link has expired or was already used. Request a new link.'
  if (/operation-not-allowed/.test(m)) return 'Adding an email isn’t available yet. Please try again later.'
  if (/provider-already-linked/.test(m)) return 'This account can already sign in with email and password. Use Forgot password if you need a new one.'
  if (/requires-recent-login|user-token-expired|session-changed|invalid-user-token/.test(m)) {
    return 'For your security, sign out and sign in again with your mobile number, then return to Settings to finish.'
  }
  if (/user-disabled/.test(m)) return 'This account is disabled. Contact iDogs support.'
  if (/weak-password/.test(m)) return 'Choose a stronger password (at least 8 characters, not easy to guess).'
  if (/too-many-requests|quota-exceeded/.test(m)) return 'Too many attempts. Please wait a few minutes and try again.'
  if (/network-request-failed/.test(m)) return 'No connection. Check your internet and try again.'
  if (/invalid-email/.test(m)) return 'Enter a valid email address.'
  if (m && !m.startsWith('Firebase:') && !m.startsWith('auth/')) return m
  return 'Could not add email sign-in. Please try again shortly.'
}
