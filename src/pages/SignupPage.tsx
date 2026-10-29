import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'
import { signupDestination, splitDisplayName } from '../lib/quickSignup'
import { trackCompletedRegistration } from '../lib/metaPixel'
import SocialSignIn from '../components/ui/SocialSignIn'
interface Props { toast: (msg: string, type?: ToastMessage['type']) => void }
export default function SignupPage({ toast }: Props) {
  const { signup, socialLogin } = useAuth(), navigate = useNavigate()
  const [params] = useSearchParams(), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const returnTo = signupDestination(params.get('next')), puppy = returnTo.startsWith('/app/puppy-updates/')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [showPassword, setShowPassword] = useState(false), [marketingOptIn, setMarketingOptIn] = useState(false)
  function failure(err: unknown) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('email-required')) { if ((err as { suggestedName?: string }).suggestedName) setName((err as { suggestedName: string }).suggestedName); setError('Your provider did not share an email. Continue below with your email to finish creating an account.'); return }
    setError(message.includes('email-already-in-use') ? 'This email is already registered. Sign in to continue.' : message.includes('account-exists-with-different-credential') ? 'Use your existing sign-in method for this email. Your accounts have not been merged.' : message.includes('popup-closed') ? 'Sign-in cancelled. Try again or continue with email.' : message.includes('weak-password') ? 'Choose a stronger password with at least 8 characters.' : 'Could not create your account. Try again or continue with email.')
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!name.trim() || !email.trim() || password.length < 8) { setError('Enter your name, email and a password of at least 8 characters.'); return }
    setLoading(true)
    try {
      await signup({ ...splitDisplayName(name), email: email.trim(), password, kennelName: '', role: 'owner', marketingOptIn })
      trackCompletedRegistration(); toast('Welcome to iDogs!'); navigate(returnTo, { replace: true })
    } catch (err) { failure(err) } finally { setLoading(false) }
  }
  async function social(provider: 'google.com' | 'facebook.com') {
    setLoading(true); setError('')
    try { const created = await socialLogin(provider, marketingOptIn); if (created) trackCompletedRegistration(); navigate(returnTo, { replace: true }) } catch (err) { failure(err) } finally { setLoading(false) }
  }
  return <div style={{ minHeight: '100dvh', background: 'var(--sand)', padding: '32px 16px' }}><div style={{ maxWidth: 440, margin: '0 auto' }}>
    <div style={{ textAlign: 'center', marginBottom: 24 }}><Link to="/"><img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ width: 190, height: 62, objectFit: 'contain' }} /></Link></div>
    <section className="card" style={{ padding: '28px 24px' }}><h1 style={{ fontSize: 26, margin: '0 0 8px' }}>{puppy ? 'Keep their story close' : 'Welcome to iDogs'}</h1><p style={{ color: 'var(--mid)', margin: '0 0 20px' }}>{puppy ? 'Create your free account to follow this puppy. No app download needed.' : 'A home for every dog’s story. Create your free account and explore.'}</p>
      <p style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.6 }}>By creating an account or continuing with a provider, you agree to our <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</p>
      <SocialSignIn busy={loading} onContinue={social} />
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label>Your name<input className="form-input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={120} disabled={loading} placeholder="What should we call you?" /></label>
        <label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} placeholder="you@example.com" /></label>
        <label>Password<div style={{ display: 'flex', gap: 8 }}><input className="form-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required disabled={loading} placeholder="At least 8 characters" /><button type="button" className="btn btn-secondary" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
        <label style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--mid)' }}><input type="checkbox" checked={marketingOptIn} onChange={e => setMarketingOptIn(e.target.checked)} disabled={loading} />Email me iDogs news and offers (optional). Unsubscribe any time.</label>
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ minHeight: 48 }}>{loading ? 'Creating your account…' : 'Create free account'}</button>
      </form><p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 0 }}>No card required. Add details later, when you need them.</p>
    </section><p style={{ textAlign: 'center' }}>Already have an account? <Link to={`/login?next=${encodeURIComponent(returnTo)}`}>Sign in</Link></p><p style={{ textAlign: 'center' }}><Link to={puppy ? `/p/${encodeURIComponent(returnTo.split('/').slice(-1)[0].split('?')[0])}` : '/'}>Continue browsing</Link></p>
  </div></div>
}
