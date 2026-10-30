import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { accountSetupRequest, finishPrimaryPassword, linkPrimaryEmail, onboardingQaEnabled } from '../lib/accountOnboarding'
import { signupDestination } from '../lib/quickSignup'
import AuthLayout from '../components/ui/AuthLayout'
import LoadingScreen from '../components/ui/LoadingScreen'
export default function CompleteAccountPage() {
  const { user, loading, checkEmailVerified } = useAuth(), [params] = useSearchParams(), navigate = useNavigate()
  const destination = signupDestination(params.get('next'))
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [email, setEmail] = useState(''), [message, setMessage] = useState('')
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate replace to={`/login?next=${encodeURIComponent(destination)}`} />
  if (!onboardingQaEnabled()) return <Navigate replace to={destination} />
  const hasPasswordProvider = user.providerData.some(p => p.providerId === 'password')
  async function addEmail(event: FormEvent) {
    event.preventDefault(); if (!user || busy) return
    setBusy(true); setError('')
    try { const result = await linkPrimaryEmail(user, email, password); await checkEmailVerified(); setMessage(result.sent ? 'Verification email sent. Open the message before continuing.' : 'Your email and password were linked. Please retry Send verification email below.'); }
    catch { setError('Could not link this email. If it belongs to an existing account, sign in there; accounts have not been merged. Otherwise check your email and password or sign in to this same mobile account again.') }
    finally { setPassword(''); setBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!user || busy) return
    setBusy(true); setError('')
    try {
      if (!await checkEmailVerified()) throw new Error('Please verify your email first.')
      await finishPrimaryPassword(user, password)
      navigate(destination, { replace: true })
    } catch { setError(hasPasswordProvider ? 'Could not confirm your password. Use your existing email password, or reset it using the email link. If your session has expired, sign in to this same account again.' : 'Could not finish setup. Check email verification and choose a password with at least 8 characters. If your session has expired, sign in to this same account again.') }
    finally { setPassword(''); setBusy(false) }
  }
  return <AuthLayout title="Keep your account secure" description="Finish setting up email sign-in. Your dogs, records and subscription stay with this account.">
    <p className="idogs-auth-small" style={{ marginBottom: 16 }}>You can still view public puppy QR profiles without signing in. Complete these steps before managing your account.</p>
    {message && <p role="status" className="idogs-auth-small">{message}</p>}
    {!user.email ? <form className="idogs-auth-form" onSubmit={addEmail}>
      <h2 style={{ fontSize: 18 }}>1. Add your email and password</h2>
      <label>Email address<input className="form-input" type="email" autoComplete="email" required value={email} disabled={busy} onChange={e=>setEmail(e.target.value)} /></label>
      <label>New password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="idogs-auth-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save email and send verification'}</button>
    </form> : !user.emailVerified ? <><h2 style={{ fontSize: 18 }}>2. Verify your email</h2><p className="idogs-auth-small">Open the verification email for {user.email}. Your existing account is kept.</p><Link className="btn btn-primary" to={`/verify-email?next=${encodeURIComponent(destination)}`}>Check or resend verification email</Link></> : <form className="idogs-auth-form" onSubmit={submit}>
      <p>Verified email: <strong style={{ overflowWrap: 'anywhere' }}>{user.email}</strong></p>
      <h2 style={{ fontSize: 18 }}>3. {hasPasswordProvider ? 'Confirm your email password' : 'Create your email password'}</h2>
      <label>{hasPasswordProvider ? 'Current password' : 'New password'}<input className="form-input" type="password" autoComplete={hasPasswordProvider ? 'current-password' : 'new-password'} minLength={hasPasswordProvider ? 1 : 8} maxLength={128} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {hasPasswordProvider && <p className="idogs-auth-small">If you previously used an email link and have no password yet, use Reset password to create one through your verified email.</p>}
      {error && <p role="alert" className="idogs-auth-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Confirming your account…' : 'Save and continue'}</button>
      <Link to={`/forgot-password?next=${encodeURIComponent(destination)}`}>Reset password</Link>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={async () => { if (!user) return; setBusy(true); try { const result = await accountSetupRequest(user); if (result.ready) navigate(destination, {replace:true}); else setError('Email verification and a working password still need to be confirmed.') } catch { setError('Could not check setup. Try again or sign in to this account again.') } finally { setBusy(false) } }}>Check completed setup</button>
    </form>}
    <p className="idogs-auth-small" style={{ marginTop: 20 }}><Link to={`/login?next=${encodeURIComponent(destination)}`}>Return to sign in</Link> · <Link to={destination.startsWith('/p/') ? destination.split('?')[0] : '/'}>Keep browsing public profiles</Link></p>
    {import.meta.env.DEV && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'demo-idogs-account-onboarding' && <p className="idogs-auth-small" style={{marginTop:16}}><Link target="_blank" to="/qa/onboarding">Open simulated email inbox (local QA)</Link></p>}
  </AuthLayout>
}
