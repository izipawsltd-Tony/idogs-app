import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingScreen from '../components/ui/LoadingScreen'
import type { ToastMessage } from '../types'
import { safeAppReturnTo } from '../lib/returnTo'
import { verifyBeforeUpdateEmail } from 'firebase/auth'
import { verificationDelivery, rememberVerificationDelivery, isThrottleError, THROTTLE_RETRY_MS, type Delivery } from '../lib/signupVerification'
import { emailPasswordLinkEnabled, emailPasswordLinkErrorMessage, sendAddEmailLink } from '../lib/emailPasswordLink'

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
  const [delivery, setDelivery] = useState<Delivery | null>(() => verificationDelivery(user?.uid))
  useEffect(() => { setDelivery(verificationDelivery(user?.uid)) }, [user?.uid])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  const throttledUntil = delivery?.status === 'throttled' && delivery.retryAt && delivery.retryAt > now ? delivery.retryAt : 0
  const at = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

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
      } else if (delivery?.status === 'sent') {
        toast(`Not verified yet. Open the link in the email we sent at ${at(delivery.attemptedAt)} (check Spam too), then try again.`, 'error')
      } else if (throttledUntil) {
        toast(`Not verified yet. We couldn't send your verification email because of a temporary sending limit. Please try again after ${at(throttledUntil)}.`, 'error')
      } else {
        toast('Not verified yet. We haven’t been able to send your verification email yet — choose Send verification email.', 'error')
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
      if (user && !user.email) {
        if (!contactEmail.trim()) { toast('Enter your email address.', 'error'); return }
        // verifyBeforeUpdateEmail needs an EXISTING email (auth/missing-email
        // for SMS-only accounts), so a first email is proved with a one-time
        // link instead and linked to this same account (see emailPasswordLink).
        // Kill switch VITE_IDOGS_EMAIL_PASSWORD_LINK=0 restores the old call.
        if (emailPasswordLinkEnabled()) {
          try { await sendAddEmailLink(user, contactEmail, location.origin, returnTo) } catch (err) { toast(emailPasswordLinkErrorMessage(err), 'error'); return }
          toast('Check your inbox and open the link on this device to add your email.')
          setCooldown(60)
          return
        }
        await verifyBeforeUpdateEmail(user, contactEmail.trim(), { url: `${location.origin}/verify-email?next=${encodeURIComponent(returnTo)}` })
      } else {
        await resendVerificationEmail()
        if (user) setDelivery(rememberVerificationDelivery(user.uid, 'sent'))
      }
      toast('Verification email sent! It can take a minute to arrive.')
      setCooldown(60)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (user && user.email && !message.includes('idogs/verification-cooldown')) {
        setDelivery(isThrottleError(err) ? rememberVerificationDelivery(user.uid, 'throttled', Date.now() + THROTTLE_RETRY_MS) : rememberVerificationDelivery(user.uid, 'failed'))
      }
      if (message.includes('idogs/verification-cooldown')) setCooldown(60)
      toast(message.includes('email-already-in-use') ? 'This email belongs to an existing account. Sign in to that account; your accounts have not been merged.' : message.includes('requires-recent-login') ? 'Please sign in again before adding your email.' : message.includes('idogs/verification-cooldown') ? 'We just sent a verification email. Please check your inbox and Spam, or wait a minute before requesting another.' : isThrottleError(err) ? `Sending is temporarily limited. Please try again after ${at(Date.now() + THROTTLE_RETRY_MS)} — you can keep exploring meanwhile.` : 'We couldn’t send the verification email just now. Please try again in a few minutes.', 'error')
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
            {user?.email ? 'Verify your email' : 'Add your email address'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.6, marginBottom: 4 }}>
            {user?.email ? 'Verify this email to continue securely:' : 'Use an email you can access to help keep your dog’s profile and records secure.'}
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>
            {user?.email}
          </p>
          <p style={{ fontSize: 13, color: 'var(--light)', lineHeight: 1.6, marginBottom: 8 }}>
            {delivery?.status === 'sent'
              ? `We sent a verification email at ${at(delivery.attemptedAt)}. Open the link in it, then return here to continue.`
              : throttledUntil
                ? `We couldn't send your verification email yet: sending is temporarily limited. You can try again after ${at(throttledUntil)} — no need to keep retrying. You can keep exploring meanwhile.`
                : delivery?.status === 'failed'
                  ? 'Your account is ready, but we couldn’t send the verification email yet. Choose Send verification email to try again.'
                  : 'Choose Send verification email to get your link, then open it and return here to continue.'}
          </p>
          {delivery?.status === 'sent' && <p style={{ fontSize: 12, color: 'var(--gold)', lineHeight: 1.6, marginBottom: 24, background: 'var(--gold-light)', padding: '8px 12px', borderRadius: 8 }}>
            💡 Can't find it? Check your <strong>Spam</strong> or <strong>Junk</strong> folder — verification emails sometimes end up there.
          </p>}

          <button onClick={handleCheck} className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={checking}>
            {checking ? <span className="spinner" /> : "I've verified — continue"}
          </button>

          {!user?.email && <label>Your email address<input className="form-input" type="email" autoComplete="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="The email you use for your dog’s profile" /></label>}
          {!user?.email && (returnTo.startsWith('/app/shared-dogs/') || returnTo.startsWith('/app/claim-dogs')) && <p style={{ fontSize: 12, color: 'var(--mid)' }}>For a breeder’s private records or ownership invitation, use the email the invitation was sent to.</p>}
          <button
            onClick={handleResend}
            className="btn btn-secondary"
            style={{ width: '100%', height: 44, marginTop: 10 }}
            disabled={resending || cooldown > 0 || !!throttledUntil}
          >
            {resending ? <span className="spinner" /> : throttledUntil ? `Try again after ${at(throttledUntil)}` : cooldown > 0 ? `Resend in ${cooldown}s` : delivery?.status === 'sent' ? 'Resend verification email' : 'Send verification email'}
          </button>

          <p><Link to="/app/start">Keep exploring for now</Link></p>
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
