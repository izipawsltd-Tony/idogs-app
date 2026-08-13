import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  User
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { createUserProfile, getUserProfile, updateUserProfile, deleteUserData } from '../lib/db'
import type { UserProfile, SignupFormData } from '../types'

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  signup: (data: SignupFormData) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  refreshProfile: () => Promise<void>
  upgradeToBreeder: () => Promise<void>
  resendVerificationEmail: () => Promise<void>
  checkEmailVerified: () => Promise<boolean>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true)
      setUser(u)
      if (u) {
        try {
          const p = await getUserProfile(u.uid)
          setProfile(p)
        } catch (err) {
          // Super Admin routing depends on the verified Firebase identity,
          // not on a Firestore profile read succeeding. Fail closed for the
          // normal profile while still allowing the route guards to settle.
          console.error('Failed to load user profile:', err)
          setProfile(null)
        }
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function signup({ email, password, firstName, lastName, kennelName, role, state, breederNumber }: SignupFormData) {
    const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password)
    try {
      await sendEmailVerification(newUser)
      await createUserProfile(newUser.uid, {
        email,
        firstName,
        lastName,
        kennelName,
        role: role || 'breeder',
        plan: 'trial',
        ...(state && { state: state as UserProfile['state'] }),
        ...(breederNumber?.trim() && { breederIdValue: breederNumber.trim() }),
      })
      const p = await getUserProfile(newUser.uid)
      setProfile(p)
    } catch (err) {
      // Rollback: remove the Auth user so the email isn't permanently locked
      // behind a half-created account the user can never log into.
      try { await newUser.delete() } catch { /* best-effort; ignore if already gone */ }
      throw err
    }
  }

  async function login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password)
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

  async function refreshProfile() {
    if (!user) return
    const p = await getUserProfile(user.uid)
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
    setUser(auth.currentUser)
    return verified
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signup, login, logout, resetPassword, refreshProfile, upgradeToBreeder, resendVerificationEmail, checkEmailVerified, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
