import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'
import { signupDestination } from '../lib/quickSignup'
import PasswordlessSignIn from '../components/ui/PasswordlessSignIn'
import AuthLayout from '../components/ui/AuthLayout'
import SocialSignIn from '../components/ui/SocialSignIn'
import SignupConsent from '../components/ui/SignupConsent'

interface Props { toast: (msg: string, type?: ToastMessage['type']) => void }
export default function LoginPage({ toast }: Props) {
  const { login, socialLogin } = useAuth(), navigate = useNavigate()
  const [params] = useSearchParams(), returnTo = signupDestination(params.get('next'))
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [socialChoice, setSocialChoice] = useState<'google.com' | 'facebook.com' | null>(null)
  const [agreed, setAgreed] = useState(false), [promotions, setPromotions] = useState(true), [promotionsConfirmed, setPromotionsConfirmed] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await login(email.trim(), password); navigate(returnTo, { replace: true }) }
    catch { setError('Could not sign in. Check your email and password, or reset your password.'); setBusy(false) }
  }
  async function social() {
    if (!socialChoice || !agreed) return
    setBusy(true); setError('')
    try { const created = await socialLogin(socialChoice, promotions && promotionsConfirmed, true); if (created) toast('Welcome to iDogs!'); navigate(returnTo, { replace: true }) }
    catch { setError('Could not sign in with this provider. Try email or mobile number.'); setBusy(false) }
  }
  const puppy = returnTo.startsWith('/p/')
  return <AuthLayout title="Welcome back" description="Sign in to keep your dog’s story close." backTo={puppy ? returnTo.split('?')[0] : '/'} backLabel={puppy ? 'Back to dog profile' : 'Back to iDogs'}>
    <div className="idogs-auth-tabs" aria-label="Choose how to sign in"><button type="button" aria-pressed={method === 'email'} disabled={busy} onClick={() => setMethod('email')}>Email</button><button type="button" aria-pressed={method === 'phone'} disabled={busy} onClick={() => setMethod('phone')}>Mobile number</button></div>
    {method === 'email' ? <form className="idogs-auth-form" onSubmit={submit}>
      <label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} placeholder="you@example.com" /></label>
      <label>Password<span className="idogs-auth-password"><input className="form-input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} /><button type="button" className="btn btn-secondary" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(v => !v)}>{show ? 'Hide' : 'Show'}</button></span></label>
      <Link to="/forgot-password" style={{ fontSize: 13 }}>Forgot password?</Link>
      {error && <p role="alert" className="idogs-auth-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form> : <PasswordlessSignIn next={returnTo} phoneOnly onBusyChange={setBusy} />}
    <div className="idogs-auth-divider">or</div><SocialSignIn busy={busy} onContinue={setSocialChoice} />
    {socialChoice && <div className="idogs-auth-form"><p className="idogs-auth-small">For your first visit, please confirm your account preferences. Existing preferences will stay as they are.</p><SignupConsent agreed={agreed} onAgree={setAgreed} promotions={promotions} onPromotions={value => { setPromotions(value); setPromotionsConfirmed(true) }} promotionsConfirmed={promotionsConfirmed} busy={busy} /><button type="button" className="btn btn-primary" disabled={busy || !agreed} onClick={() => void social()}>Continue with {socialChoice === 'google.com' ? 'Google' : 'Facebook'}</button></div>}
    <p className="idogs-auth-switch">New to iDogs? <Link to={`/signup?next=${encodeURIComponent(returnTo)}`}>Create free account</Link></p>
  </AuthLayout>
}
