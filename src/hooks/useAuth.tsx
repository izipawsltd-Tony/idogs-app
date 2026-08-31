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

  async function loadProfileWithVerifiedBilling(u: User): Promise<UserProfile | null> {
    const p = await getUserProfile(u.uid)
    if (!p) return p

    try {
      const idToken = await u.getIdToken()
      const res = await fetch('/api/billing-summary', {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.entitlement) {
        return {
          ...p,
          plan: body.entitlement.plan === 'plus' ? 'plus' : p.plan,
          ...(body.entitlement.billingInterval ? { billingInterval: body.entitlement.billingInterval } : {}),
          ...(body.entitlement.subscriptionStatus ? { subscriptionStatus: body.entitlement.subscriptionStatus } : {}),
        } as UserProfile
      }
    } catch (err) {
      console.error('Failed to merge verified billing entitlement:', err)
    }

    return p
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true)
      setUser(u)
      if (u) {
        try {
          const p = await loadProfileWithVerifiedBilling(u)
          setProfile(p)
        } catch (err) {
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

  useEffect(() => {
    if (!user) return

    const refreshVerifiedProfile = () => {
      void loadProfileWithVerifiedBilling(user)
        .then(setProfile)
        .catch(err => console.error('Failed to refresh verified profile:', err))
    }

    window.addEventListener('focus', refreshVerifiedProfile)
    window.addEventListener('pageshow', refreshVerifiedProfile)
    return () => {
      window.removeEventListener('focus', refreshVerifiedProfile)
      window.removeEventListener('pageshow', refreshVerifiedProfile)
    }
  }, [user?.uid])

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
      const p = await loadProfileWithVerifiedBilling(newUser)
      setProfile(p)
    } catch (err) {
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
    const p = await loadProfileWithVerifiedBilling(user)
    setProfile(p)
  }

  async function refreshProfile() {
    if (!user) return
    const p = await loadProfileWithVerifiedBilling(user)
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
