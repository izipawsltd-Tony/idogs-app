import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'
import { signupDestination } from '../lib/quickSignup'
import AuthLayout from '../components/ui/AuthLayout'
import { MobileNumberUnavailable } from '../components/ui/MobileNumberUnavailable'

interface Props { toast: (msg: string, type?: ToastMessage['type']) => void }

// Same layout and copy as idogs.com.au. The iOS app keeps email + password
// sign-in; social and passwordless methods are web-only for now.
export default function LoginPage(_props: Props) {
  const { user, login } = useAuth(), navigate = useNavigate()
  const [params] = useSearchParams(), returnTo = signupDestination(params.get('next'))
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')

  useEffect(() => { if (user) navigate(returnTo, { replace: true }) }, [user, navigate, returnTo])

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await login(email.trim(), password) }
    catch { setError('Could not sign in. Check your email and password, or reset your password.'); setBusy(false) }
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
    </form> : <MobileNumberUnavailable onUseEmail={() => setMethod('email')} />}
    <p className="idogs-auth-switch">New to iDogs? <Link to={`/signup?next=${encodeURIComponent(returnTo)}`}>Create free account</Link></p>
  </AuthLayout>
}
