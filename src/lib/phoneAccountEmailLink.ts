import { EmailAuthProvider, linkWithCredential, reload, sendEmailVerification, type User } from 'firebase/auth'
import { auth } from './firebase'

// Opt-in staging only. Never enable a new sign-in/migration flow in a
// Production build just by deploying this code.
export function phoneEmailLinkStagingEnabled() {
  return import.meta.env.VITE_FIREBASE_PROJECT_ID === 'idogs-app-staging' &&
    import.meta.env.VITE_IDOGS_PHONE_ACCOUNT_LINK_QA === '1'
}

export type PhoneEmailLinkResult = {
  uid: string
  email: string
  verificationSent: boolean
}

export async function linkEmailPasswordToExistingPhoneAccount(
  currentUser: User,
  requestedEmail: string,
  password: string,
): Promise<PhoneEmailLinkResult> {
  if (!phoneEmailLinkStagingEnabled()) throw new Error('Phone account linking is not enabled in this environment.')
  if (!currentUser || auth.currentUser?.uid !== currentUser.uid) throw new Error('Sign in to your original phone account first.')
  await reload(currentUser)
  if (auth.currentUser?.uid !== currentUser.uid) throw new Error('Account changed. Sign in again.')
  if (!currentUser.providerData.some(provider => provider.providerId === 'phone')) {
    throw new Error('This is not an existing phone account.')
  }
  if (currentUser.email || currentUser.providerData.some(provider => provider.providerId === 'password')) {
    throw new Error('This account already has email/password credentials. Use password recovery if needed.')
  }
  const email = requestedEmail.trim().toLowerCase()
  if (!email || email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }
  if (password.length < 8 || password.length > 128) throw new Error('Choose a password of 8–128 characters.')
  const uid = currentUser.uid
  // Never create another Firebase user or merge identities here. The Firebase
  // credential link fails closed for an email already bound to a different UID.
  const credential = EmailAuthProvider.credential(email, password)
  const result = await linkWithCredential(currentUser, credential)
  if (result.user.uid !== uid || auth.currentUser?.uid !== uid) {
    throw new Error('Account changed after linking. Stop and sign in again.')
  }
  // Verification delivery may fail after credentials were successfully linked.
  // Do not invite a repeated link attempt or pretend the email was verified.
  let verificationSent = false
  try {
    await sendEmailVerification(result.user)
    verificationSent = true
  } catch {
    verificationSent = false
  }
  return { uid, email: result.user.email || email, verificationSent }
}
