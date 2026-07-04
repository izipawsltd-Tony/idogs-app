import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { isSuperAdminEmail } from './superAdminConfig'
import SuperAdminAccessDeniedPage from './pages/SuperAdminAccessDeniedPage'

type Props = {
  children: React.ReactNode
}

function SuperAdminLoadingScreen() {
  return (
    <div className="super-admin-loading">
      <div className="super-admin-loading-mark">
        <img src="/logo.png" alt="iDogs" />
      </div>
      <div className="spinner" />
    </div>
  )
}

export default function SuperAdminRoute({ children }: Props) {
  const { user, loading } = useAuth()

  if (loading) return <SuperAdminLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />

  // Client-side gating is for shell routing and UX only.
  // Future Super Admin APIs must verify Firebase ID tokens server-side,
  // enforce admin authorization server-side, and avoid direct browser
  // cross-tenant Firestore reads.
  if (!isSuperAdminEmail(user.email)) {
    return <SuperAdminAccessDeniedPage />
  }

  return <>{children}</>
}
