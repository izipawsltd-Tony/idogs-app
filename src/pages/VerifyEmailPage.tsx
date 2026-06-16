import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function VerifyEmailPage({ toast }: Props) {
  const { user, loading, logout, resendVerificationEmail, checkEmailVerified } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // If not logged in at all, send to login
  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true })
  }, [loading, user, navigate])

  // If already verified, go straight to dashboard
  useEffect(() => {
    if (!loading && user?.emailVerified) navigate('/app/dashboard', { replace: true })
  }, [loading, user, navigate])

  // Cooldown timer for resend button
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  async function handleCheck() {
    setChecking(true)
    try {
      const verified = await checkEmailVerified()
      if (verified) {
        toast('Email verified! Welcome to iDogs.')
        navigate('/app/dashboard', { replace: true })
      } else {
        toast('Not verified yet. Please click the link in your email first.', 'error')
      }
    } catch {
      toast('Could not check verification status. Please try again.', 'error')
    } finally {
      setChecking(false)
    }
  }

  async function handleResend() {
    setResending(true)
    try {
      await resendVerificationEmail()
      toast('Verification email sent!')
      setCooldown(60)
    } catch {
      toast('Failed to resend. Please try again shortly.', 'error')
    } finally {
      setResending(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sand)' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--sand)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{ width: 40, height: 40, background: 'var(--green)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🐾</div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--dark)' }}>iDogs</span>
          </Link>
        </div>

        <div className="card" style={{ padding: '36px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>📬</div>
          <h1 style={{ fontSize: 20, fontFamily: 'var(--font-display)', marginBottom: 8, color: 'var(--dark)' }}>
            Verify your email
          </h1>
          <p style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.6, marginBottom: 4 }}>
            We sent a verification link to
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>
            {user?.email}
          </p>
          <p style={{ fontSize: 13, color: 'var(--light)', lineHeight: 1.6, marginBottom: 24 }}>
            Click the link in that email, then come back here and press the button below.
          </p>

          <button onClick={handleCheck} className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={checking}>
            {checking ? <span className="spinner" /> : "I've verified — continue"}
          </button>

          <button
            onClick={handleResend}
            className="btn btn-secondary"
            style={{ width: '100%', height: 44, marginTop: 10 }}
            disabled={resending || cooldown > 0}
          >
            {resending ? <span className="spinner" /> : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
          </button>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button onClick={handleLogout} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--light)', cursor: 'pointer', textDecoration: 'underline' }}>
              Sign out and use a different account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
