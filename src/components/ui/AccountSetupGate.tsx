import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { accountSetupRequest, onboardingQaEnabled } from '../../lib/accountOnboarding'
import LoadingScreen from './LoadingScreen'
export default function AccountSetupGate({ children }: { children: ReactNode }) {
  const { user } = useAuth(), location = useLocation()
  const [state, setState] = useState<{ uid: string; ready: boolean; error: boolean } | null>(null)
  const enabled = onboardingQaEnabled()
  useEffect(() => {
    let live = true
    if (enabled && user) accountSetupRequest(user).then(result => { if (live) setState({ uid: user.uid, ready: result.ready, error: false }) }).catch(() => { if (live) setState({ uid: user.uid, ready: false, error: true }) })
    return () => { live = false }
  }, [enabled, user?.uid, user?.emailVerified, user?.email])
  if (!enabled) return <>{children}</>
  if (!user || state?.uid !== user.uid) return <LoadingScreen />
  if (!state.ready) return <Navigate replace to={`/complete-account?next=${encodeURIComponent(location.pathname + location.search)}${state.error ? '&retry=1' : ''}`} />
  return <>{children}</>
}
