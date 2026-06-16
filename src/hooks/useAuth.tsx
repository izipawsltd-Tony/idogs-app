import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  User
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { createUserProfile, getUserProfile, updateUserProfile } from '../lib/db'
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
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const p = await getUserProfile(u.uid)
        setProfile(p)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function signup({ email, password, firstName, lastName, kennelName, role }: SignupFormData & { role?: string }) {
    const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password)
    await createUserProfile(newUser.uid, {
      email,
      firstName,
      lastName,
      kennelName,
      role: (role as any) || 'breeder',
      plan: 'trial',
    })
    const p = await getUserProfile(newUser.uid)
    setProfile(p)
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

  return (
    <AuthContext.Provider value={{ user, profile, loading, signup, login, logout, resetPassword, refreshProfile, upgradeToBreeder }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
