import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingScreen from '../components/ui/LoadingScreen'
import type { ToastMessage } from '../types'
import { safeAppReturnTo } from '../lib/returnTo'
import { verifyBeforeUpdateEmail } from 'firebase/auth'
import { verificationDelivery } from '../lib/signupVerification'
import { auth } from '../lib/firebase'

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
  const [contactEmail, setContactEmail] = useState('')
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const initialDelivery = verificationDelivery(user?.uid)

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
    if (checking || resending) return
    setChecking(true)
    setError(''); setNeedsSignIn(false)
    try {
      const verified = await checkEmailVerified()
      const currentEmail = auth.currentUser?.email || user?.email
      if (verified && currentEmail) {
        toast('Email verified! Welcome to iDogs.')
        navigate(returnTo, { replace: true })
      } else {
        setError(currentEmail ? 'This account’s email is not verified yet. Check the address above, open the verification link in your inbox, then choose I’ve verified — continue.' : 'An email has not been verified for this signed-in account yet. Check the address, choose Send verification email, and open the link. If this email belongs to an existing iDogs account, sign in to that account instead.')
      }
    } catch {
      setError('Could not check verification status. Please try again. Your verification has not been confirmed.')
    } finally {
      setChecking(false)
    }
  }

  async function handleResend() {
    if (checking || resending || cooldown > 0) return
    setResending(true)
    setError(''); setNeedsSignIn(false)
    try {
      if (user && !user.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) { setError('Enter a valid email address and check the spelling before sending.'); return }
        await verifyBeforeUpdateEmail(user, contactEmail.trim(), { url: `${location.origin}/verify-email?next=${encodeURIComponent(returnTo)}` })
      } else await resendVerificationEmail()
      setSentTo(user?.email || contactEmail.trim())
      toast('Verification email sent!')
      setCooldown(60)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      const recentLogin = message.includes('requires-recent-login') || message.includes('user-token-expired')
      setNeedsSignIn(recentLogin)
      setError(message.includes('email-already-in-use') ? 'This email belongs to an existing account. Sign in to that account to access its dogs and records. Your accounts have not been merged.' : recentLogin ? 'For your account’s security, sign in again before adding an email. Use Sign in again below, then return here to retry.' : message.includes('invalid-email') ? 'This email address is not valid. Check the spelling and try again.' : 'Could not send the verification email. Check the address and try again shortly.')
    } finally {
      setResending(false)
    }
  }

  async function handleLogout(returnToVerification = false) {
    await logout()
    const next = returnToVerification ? `/verify-email?next=${encodeURIComponent(returnTo)}` : returnTo
    navigate(`/login?next=${encodeURIComponent(next)}`)
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
            {user?.email ? 'Verify your email' : 'Add your email address'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.6, marginBottom: 4 }}>
            {user?.email ? 'Verify this email to continue securely:' : 'Use an email you can access to help keep your dog’s profile and records secure.'}
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>
            {user?.email}
          </p>
          <p style={{ fontSize: 13, color: 'var(--light)', lineHeight: 1.6, marginBottom: 8 }}>
            {initialDelivery?.status === 'sent' ? 'A verification email has already been sent. Open the link in your inbox, then return here to continue. You can request another email below.' : initialDelivery?.status === 'failed' ? 'Your account is ready, but the first verification email could not be sent. Choose Send verification email to try again.' : 'Choose Send verification email, open the link in your inbox, then return here to continue.'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--gold)', lineHeight: 1.6, marginBottom: 24, background: 'var(--gold-light)', padding: '8px 12px', borderRadius: 8 }}>
            💡 Can't find it? Check your <strong>Spam</strong> or <strong>Junk</strong> folder — verification emails sometimes end up there.
          </p>

          {!user?.email && <label style={{ display: 'block', textAlign: 'left', marginBottom: 14 }}>Your email address<input className="form-input" type="email" autoComplete="email" value={contactEmail} disabled={checking || resending} onChange={e => { setContactEmail(e.target.value); setError(''); setSentTo('') }} placeholder="The email you use for your dog’s profile" /><span style={{ display: 'block', fontSize: 12, color: 'var(--mid)', marginTop: 6 }}>Check the spelling. Adding an email does not sign you in to another account.</span></label>}
          {!user?.email && (returnTo.startsWith('/app/shared-dogs/') || returnTo.startsWith('/app/claim-dogs')) && <p style={{ fontSize: 12, color: 'var(--mid)' }}>For a breeder’s private records or ownership invitation, use the email the invitation was sent to.</p>}
          {error && <p role="alert" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--danger)', textAlign: 'left' }}>{error}</p>}
          {sentTo && <p role="status" style={{ fontSize: 13 }}>Verification email requested for {sentTo}. Open the link before continuing.</p>}
          <button onClick={handleCheck} className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={checking || resending}>
            {checking ? <span className="spinner" /> : "I've verified — continue"}
          </button>

          <button
            onClick={handleResend}
            className="btn btn-secondary"
            style={{ width: '100%', height: 44, marginTop: 10 }}
            disabled={checking || resending || cooldown > 0}
          >
            {resending ? <span className="spinner" /> : cooldown > 0 ? `Resend in ${cooldown}s` : initialDelivery?.status === 'sent' ? 'Resend verification email' : 'Send verification email'}
          </button>
          {needsSignIn && <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => void handleLogout(true)}>Sign in again</button>}

          <p><Link to="/app/start">Keep exploring for now</Link></p>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button onClick={() => void handleLogout()} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--light)', cursor: 'pointer', textDecoration: 'underline' }}>
              Sign out and use a different account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
