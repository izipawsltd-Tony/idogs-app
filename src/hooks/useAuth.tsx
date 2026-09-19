import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
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

async function loadAuthRuntime() {
  const [{ auth }, authSdk] = await Promise.all([
    import('../lib/firebase'),
    import('firebase/auth'),
  ])
  return { auth, authSdk }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | undefined
    let started = false
    let timer: number | undefined

    const startAuthListener = async () => {
      if (started || cancelled) return
      started = true
      try {
        const [{ auth, authSdk }, { getUserProfile }] = await Promise.all([
          loadAuthRuntime(),
          import('../lib/db'),
        ])
        if (cancelled) return
        unsub = authSdk.onAuthStateChanged(auth, async (u) => {
          setLoading(true)
          setUser(u)
          if (u) {
            try {
              const p = await getUserProfile(u.uid)
              if (!cancelled) setProfile(p)
            } catch (err) {
              console.error('Failed to load user profile:', err)
              if (!cancelled) setProfile(null)
            }
          } else if (!cancelled) {
            setProfile(null)
          }
          if (!cancelled) setLoading(false)
        })
      } catch (err) {
        console.error('Failed to initialise authentication:', err)
        if (!cancelled) setLoading(false)
      }
    }

    // The public landing page does not need Firebase in order to paint. Give
    // its LCP path a clean three-second window, but initialise immediately if
    // the visitor navigates away before then. Non-landing routes initialise
    // auth without delay.
    if (window.location.pathname === '/') {
      timer = window.setTimeout(() => { void startAuthListener() }, 3000)
      const startOnNavigation = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null
        if (!target) return
        const href = target.getAttribute('href')
        if (!href) return
        try {
          const next = new URL(href, window.location.href)
          if (next.origin === window.location.origin && next.pathname !== '/') {
            void startAuthListener()
          }
        } catch {
          // Ignore malformed/non-navigation hrefs.
        }
      }
      document.addEventListener('click', startOnNavigation, true)
      return () => {
        cancelled = true
        if (timer !== undefined) window.clearTimeout(timer)
        document.removeEventListener('click', startOnNavigation, true)
        unsub?.()
      }
    }

    void startAuthListener()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  async function signup({ email, password, firstName, lastName, kennelName, role, state, breederNumber }: SignupFormData) {
    const [{ auth, authSdk }, dbApi] = await Promise.all([
      loadAuthRuntime(),
      import('../lib/db'),
    ])
    const { user: newUser } = await authSdk.createUserWithEmailAndPassword(auth, email, password)
    try {
      await authSdk.sendEmailVerification(newUser)
      await dbApi.createUserProfile(newUser.uid, {
        email,
        firstName,
        lastName,
        kennelName,
        role: role || 'breeder',
        plan: 'trial',
        ...(state && { state: state as UserProfile['state'] }),
        ...(breederNumber?.trim() && { breederIdValue: breederNumber.trim() }),
      })
      const p = await dbApi.getUserProfile(newUser.uid)
      setProfile(p)
    } catch (err) {
      try { await newUser.delete() } catch { /* best-effort; ignore if already gone */ }
      throw err
    }
  }

  async function login(email: string, password: string) {
    const { auth, authSdk } = await loadAuthRuntime()
    await authSdk.signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    const { auth, authSdk } = await loadAuthRuntime()
    await authSdk.signOut(auth)
    setProfile(null)
  }

  async function resetPassword(email: string) {
    const { auth, authSdk } = await loadAuthRuntime()
    await authSdk.sendPasswordResetEmail(auth, email)
  }

  async function upgradeToBreeder() {
    if (!user) return
    const dbApi = await import('../lib/db')
    await dbApi.updateUserProfile(user.uid, { role: 'breeder' })
    const p = await dbApi.getUserProfile(user.uid)
    setProfile(p)
  }

  async function refreshProfile() {
    if (!user) return
    const { getUserProfile } = await import('../lib/db')
    const p = await getUserProfile(user.uid)
    setProfile(p)
  }

  async function resendVerificationEmail() {
    const { auth, authSdk } = await loadAuthRuntime()
    if (!auth.currentUser) return
    await authSdk.sendEmailVerification(auth.currentUser)
  }

  async function deleteAccount() {
    if (!user) return
    const { deleteUserData } = await import('../lib/db')
    await deleteUserData(user.uid)
    await user.delete()
    setProfile(null)
  }

  async function checkEmailVerified(): Promise<boolean> {
    const { auth, authSdk } = await loadAuthRuntime()
    if (!auth.currentUser) return false
    await authSdk.reload(auth.currentUser)
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
