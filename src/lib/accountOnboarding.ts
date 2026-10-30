import { EmailAuthProvider, linkWithCredential, reauthenticateWithCredential, reload, sendEmailVerification, type User } from 'firebase/auth'
import { auth } from './firebase'
export const onboardingQaEnabled = () => import.meta.env.VITE_ACCOUNT_ONBOARDING_QA === '1'
export async function linkPrimaryEmail(user: User, email: string, password: string) {
  const uid = user.uid
  if (auth.currentUser?.uid !== uid || user.email || password.length < 8) throw new Error('Check the signed-in account and password.')
  const result = await linkWithCredential(user, EmailAuthProvider.credential(email.trim(), password))
  if (result.user.uid !== uid || auth.currentUser?.uid !== uid) throw new Error('Your account changed. Please sign in again.')
  try { await sendEmailVerification(result.user); return { sent: true } } catch { return { sent: false } }
}
export async function accountSetupRequest(user: User, password?: string) {
  const token = await user.getIdToken(true)
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Please sign in again.')
  const r = await fetch('/api/account-onboarding', { method: password === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(password === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(password === undefined ? {} : { body: JSON.stringify({ password }) }) })
  if (!r.ok) throw new Error(r.status === 401 ? 'Please sign in to this account again, then continue setup.' : r.status === 403 ? 'Could not confirm this account. Check your email verification and password.' : 'Could not check account setup. Please try again.')
  return await r.json() as { ready: boolean; required: boolean }
}
export async function finishPrimaryPassword(user: User, password: string) {
  const uid = user.uid
  await reload(user)
  if (auth.currentUser?.uid !== uid || !user.email || !user.emailVerified) throw new Error('Verify your email on this account before setting a password.')
  const credential = EmailAuthProvider.credential(user.email, password)
  // Never silently overwrite an existing password after an OTP sign-in. If
  // the email provider exists, confirm it or use email password reset.
  if (user.providerData.some(p => p.providerId === 'password')) await reauthenticateWithCredential(user, credential)
  else {
    if (password.length < 8) throw new Error('Choose a password with at least 8 characters.')
    const result = await linkWithCredential(user, credential)
    if (result.user.uid !== uid) throw new Error('Your account changed. Please sign in again.')
  }
  if (auth.currentUser?.uid !== uid) throw new Error('Your account changed. Please sign in again.')
  const result = await accountSetupRequest(user, password)
  if (!result.ready) throw new Error('Account setup has not been confirmed.')
}
