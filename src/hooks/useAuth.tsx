import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  User, GoogleAuthProvider, FacebookAuthProvider, signInWithPopup, updateProfile, getAdditionalUserInfo
} from 'firebase/auth'
import { splitDisplayName } from '../lib/quickSignup'
import { welcomeUser } from '../lib/welcomeUser'
import { auth } from '../lib/firebase'
import { createUserProfile, getUserProfile, getUserProfileFromServer, updateUserProfile, deleteUserData } from '../lib/db'
import type { UserProfile, SignupFormData } from '../types'

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  signup: (data: SignupFormData) => Promise<void>
  finishQuickSignIn: (signedInUser: User, isNew: boolean, name?: string, marketingOptIn?: boolean, termsAccepted?: boolean) => Promise<void>
  socialLogin: (provider: 'google.com' | 'facebook.com', marketingOptIn?: boolean, termsAccepted?: boolean) => Promise<boolean>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  refreshProfile: (fromServer?: boolean) => Promise<void>
  upgradeToBreeder: () => Promise<void>
  resendVerificationEmail: () => Promise<void>
  checkEmailVerified: () => Promise<boolean>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authGeneration = useRef(0)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      const generation = ++authGeneration.current
      setLoading(true)
      setProfile(null)
      setUser(u)
      if (u) {
        try {
          const p = await getUserProfile(u.uid)
          if (generation === authGeneration.current) setProfile(p)
        } catch (err) {
          // Super Admin routing depends on the verified Firebase identity,
          // not on a Firestore profile read succeeding. Fail closed for the
          // normal profile while still allowing the route guards to settle.
          console.error('Failed to load user profile:', err)
          if (generation === authGeneration.current) setProfile(null)
        }
      } else {
        setProfile(null)
      }
      if (generation === authGeneration.current) setLoading(false)
    })
    return unsub
  }, [])

  async function signup({ email, password, firstName, lastName, kennelName, role, state, breederNumber, marketingOptIn = false, termsAccepted = false }: SignupFormData) {
    const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password)
    try {
      await updateProfile(newUser, { displayName: `${firstName} ${lastName}`.trim() })
      await createUserProfile(newUser.uid, {
        email,
        firstName,
        lastName,
        kennelName,
        role: role || 'owner',
        ...(termsAccepted && { termsAcceptance: { version: 'terms-2026-10-29', acceptedAt: new Date().toISOString(), source: 'signup' as const } }),
        plan: 'trial',
        marketingConsent: {
          channel: 'email_marketing',
          choice: marketingOptIn ? 'opt_in' : 'opt_out',
          source: termsAccepted ? 'explicit_choice' : 'explicit_checkbox',
          checkboxDefault: false,
          policyVersion: 'marketing-v1-2026-10',
          optedInAt: marketingOptIn ? new Date().toISOString() : null,
          revokedAt: null,
          email: newUser.email || email,
          evidenceRef: termsAccepted ? 'signup-choice-v2' : 'signup-checkbox-v1',
        },
        ...(state && { state: state as UserProfile['state'] }),
        ...(breederNumber?.trim() && { breederIdValue: breederNumber.trim() }),
      })
      const p = await getUserProfile(newUser.uid)
      ++authGeneration.current
      setProfile(p); setLoading(false)
      void welcomeUser(newUser)
    } catch (err) {
      // Rollback: remove the Auth user so the email isn't permanently locked
      // behind a half-created account the user can never log into.
      try { await newUser.delete() } catch { /* best-effort; ignore if already gone */ }
      throw err
    }
  }

  async function socialLogin(provider: 'google.com' | 'facebook.com', marketingOptIn = false, termsAccepted = false): Promise<boolean> {
    const selected = provider === 'google.com' ? new GoogleAuthProvider() : new FacebookAuthProvider()
    if (provider === 'facebook.com') selected.addScope('email')
    const result = await signInWithPopup(auth, selected)
    if (!result.user.email) { const suggestedName = result.user.displayName || ''; await signOut(auth); throw Object.assign(new Error('auth/email-required'), { suggestedName }) }
    const existing = await getUserProfile(result.user.uid)
    if (!existing) {
      const name = result.user.displayName || result.user.email?.split('@')[0] || 'Dog lover'
      await createUserProfile(result.user.uid, { email: result.user.email || '', ...splitDisplayName(name), kennelName: '', role: 'owner', marketingConsent: { channel: 'email_marketing', choice: marketingOptIn ? 'opt_in' : 'opt_out', source: termsAccepted ? 'explicit_choice' : 'explicit_checkbox', checkboxDefault: false, policyVersion: 'marketing-v1-2026-10', optedInAt: marketingOptIn ? new Date().toISOString() : null, revokedAt: null, email: result.user.email || '', evidenceRef: termsAccepted ? 'signup-choice-v2' : 'signup-checkbox-v1' } })
    }
    if (!existing && termsAccepted) await updateUserProfile(result.user.uid, { termsAcceptance: { version: 'terms-2026-10-29', acceptedAt: new Date().toISOString(), source: 'signup' } })
    const loadedProfile = await getUserProfile(result.user.uid)
    ++authGeneration.current
    setProfile(loadedProfile); setLoading(false)
    if (getAdditionalUserInfo(result)?.isNewUser === true) void welcomeUser(result.user)
    return getAdditionalUserInfo(result)?.isNewUser === true
  }

  async function login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function finishQuickSignIn(signedInUser: User, isNew: boolean, name = '', marketingOptIn = false, termsAccepted = false) {
    const existing = await getUserProfile(signedInUser.uid)
    if (!existing) {
      const displayName = name.trim() || signedInUser.displayName || 'Dog lover'
      if (!signedInUser.displayName) await updateProfile(signedInUser, { displayName })
      await createUserProfile(signedInUser.uid, {
        ...splitDisplayName(displayName), email: signedInUser.email || '', phone: signedInUser.phoneNumber || '', kennelName: '', role: 'owner',
        ...(termsAccepted && { termsAcceptance: { version: 'terms-2026-10-29', acceptedAt: new Date().toISOString(), source: 'signup' as const } }),
        ...(termsAccepted && signedInUser.phoneNumber && { smsMarketingConsent: { channel: 'sms_marketing' as const, choice: marketingOptIn ? 'opt_in' as const : 'opt_out' as const, source: 'signup' as const, policyVersion: 'marketing-v1-2026-10', optedInAt: marketingOptIn ? new Date().toISOString() : null, revokedAt: null, phone: signedInUser.phoneNumber, evidenceRef: 'signup-choice-v2' } }),
        marketingConsent: { channel: 'email_marketing', choice: marketingOptIn && !!signedInUser.email ? 'opt_in' : 'opt_out', source: termsAccepted ? 'explicit_choice' : 'explicit_checkbox', checkboxDefault: false, policyVersion: 'marketing-v1-2026-10', optedInAt: marketingOptIn && signedInUser.email ? new Date().toISOString() : null, revokedAt: null, email: signedInUser.email || '', evidenceRef: termsAccepted ? 'signup-choice-v2' : 'signup-checkbox-v1' },
      })
    }
    const nextProfile = await getUserProfile(signedInUser.uid)
    ++authGeneration.current
    setUser(signedInUser); setProfile(nextProfile); setLoading(false)
    if (isNew) void welcomeUser(signedInUser)
  }

  async function logout() {
    await signOut(auth)
    setProfile(null)
  }

  async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email)
  }

  async function upgradeToBreeder() {
    if (!user) return
    await updateUserProfile(user.uid, { role: 'breeder' })
    const p = await getUserProfile(user.uid)
    setProfile(p)
  }

  async function refreshProfile(fromServer = false) {
    if (!user) return
    const p = await (fromServer ? getUserProfileFromServer(user.uid) : getUserProfile(user.uid))
    setProfile(p)
  }

  async function resendVerificationEmail() {
    if (!auth.currentUser) return
    await sendEmailVerification(auth.currentUser)
  }

  async function deleteAccount() {
    if (!user) return
    await deleteUserData(user.uid)
    await user.delete()
    setProfile(null)
  }

  // Reloads the Firebase user and reports whether email is now verified.
  // Also forces a state update so ProtectedRoute re-evaluates immediately.
  //
  // Staging QA finding: reload() only refreshes the LOCAL profile flag
  // (auth.currentUser.emailVerified) — it never refreshes the cached ID
  // TOKEN's own embedded email_verified claim, which is what every
  // server-side check (e.g. api/private-dog-view.js's
  // `decoded.email_verified !== true`) actually authorizes against.
  // Without forcing a fresh token here, a buyer redirected straight into
  // a protected page (e.g. /app/shared-dogs/:dogId) immediately after
  // verifying got a false 403 on their very first fetch — their token
  // wouldn't naturally refresh for up to ~1h. getIdToken(true) is called
  // BEFORE setUser() deliberately: setUser() is what makes
  // `user.emailVerified` visible to ProtectedRoute and to
  // VerifyEmailPage's own "already verified, redirect" effect, so
  // gating it behind a SUCCESSFUL forced refresh means neither can ever
  // navigate the caller into a page backed by a still-stale token. If
  // the forced refresh itself fails, this throws (never silently
  // returns false) — VerifyEmailPage's existing catch block already
  // reports that accurately ("Could not check verification status"),
  // and — critically — never redirects as if verification had
  // succeeded, per the "don't treat a token-refresh failure as
  // verification failure" requirement.
  async function checkEmailVerified(): Promise<boolean> {
    if (!auth.currentUser) return false
    await reload(auth.currentUser)
    const verified = auth.currentUser.emailVerified
    if (verified) {
      await auth.currentUser.getIdToken(true)
    }
    if (verified && auth.currentUser.email) {
      const currentProfile = await getUserProfile(auth.currentUser.uid)
      if (currentProfile && currentProfile.email !== auth.currentUser.email) {
        await updateUserProfile(auth.currentUser.uid, { email: auth.currentUser.email })
        setProfile({ ...currentProfile, email: auth.currentUser.email })
      }
    }
    setUser(auth.currentUser)
    return verified
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signup, finishQuickSignIn, socialLogin, login, logout, resetPassword, refreshProfile, upgradeToBreeder, resendVerificationEmail, checkEmailVerified, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
