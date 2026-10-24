import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingScreen from '../components/ui/LoadingScreen'
import type { ToastMessage } from '../types'
import { safeAppReturnTo } from '../lib/returnTo'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function VerifyEmailPage({ toast }: Props) {
  const { user, loading, logout, resendVerificationEmail, checkEmailVerified } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = safeAppReturnTo(searchParams.get('next'))
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [sendStatus, setSendStatus] = useState('')

  // If not logged in at all, send to login
  useEffect(() => {
    if (!loading && !user) navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true })
  }, [loading, user, navigate, returnTo])

  // If already verified, go straight to dashboard
  useEffect(() => {
    if (!loading && user?.emailVerified) navigate(returnTo, { replace: true })
  }, [loading, user, navigate, returnTo])

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
        navigate(returnTo, { replace: true })
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
    if (resending || cooldown > 0 || !user) return
    setResending(true)
    setSendStatus('')
    try {
      await resendVerificationEmail()
      setSendStatus('Verification email requested. Delivery can take a few minutes. Check your inbox and Spam or Junk folder.')
      toast('Verification email requested. Please check your inbox.')
      setCooldown(60)
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : err instanceof Error ? err.message : ''
      const message = code.includes('too-many-requests')
        ? 'Too many requests. Wait a few minutes before requesting another email.'
        : code.includes('network-request-failed')
          ? 'Could not reach the email service. Check your internet connection and try again.'
          : code.includes('requires-recent-login') || code.includes('user-token-expired') || code.includes('invalid-user-token')
            ? 'Your session has expired. Sign out and sign in again before requesting another email.'
            : 'Could not request a verification email. Please try again shortly.'
      setSendStatus(message)
      toast(message, 'error')
      if (code.includes('too-many-requests')) setCooldown(60)
    } finally {
      setResending(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate(`/login?next=${encodeURIComponent(returnTo)}`)
  }

  if (loading) {
    return <LoadingScreen />
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
            A verification link is needed for
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>
            {user?.email}
          </p>
          <p style={{ fontSize: 13, color: 'var(--light)', lineHeight: 1.6, marginBottom: 8 }}>
            Click the link in that email, then come back here and press the button below.
          </p>
          <p style={{ fontSize: 12, color: 'var(--gold)', lineHeight: 1.6, marginBottom: 24, background: 'var(--gold-light)', padding: '8px 12px', borderRadius: 8 }}>
            💡 Can't find it? Check your <strong>Spam</strong> or <strong>Junk</strong> folder — verification emails sometimes end up there.
          </p>

          <button onClick={handleCheck} className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={checking}>
            {checking ? <span className="spinner" /> : "I've verified — continue"}
          </button>

          <button
            onClick={handleResend}
            className="btn btn-secondary"
            style={{ width: '100%', height: 44, marginTop: 10 }}
            disabled={!user || resending || cooldown > 0}
          >
            {resending ? <span className="spinner" /> : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
          </button>
          {sendStatus && <p role="status" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 12 }}>{sendStatus}</p>}
          <p style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.6, marginTop: 16 }}>
            Still no email after a few minutes? Request another link above. If it still does not arrive, contact{' '}
            <a href="mailto:info@idogs.com.au">info@idogs.com.au</a> using the account email shown here.
          </p>

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
