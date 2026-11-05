import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'
import { signupDestination, splitDisplayName } from '../lib/quickSignup'
import AuthLayout from '../components/ui/AuthLayout'
import SignupConsent from '../components/ui/SignupConsent'
import { DATA_PROCESSING_SUMMARY } from '../components/legal/PolicyReview'
import { MobileNumberUnavailable } from '../components/ui/MobileNumberUnavailable'

interface Props { toast: (msg: string, type?: ToastMessage['type']) => void }

// Same layout, fields and consent as idogs.com.au. Email + password only in
// the iOS app; social and passwordless sign-up stay web-only for now.
export default function SignupPage({ toast }: Props) {
  const { signup } = useAuth(), navigate = useNavigate()
  const [params] = useSearchParams()
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false), [agreed, setAgreed] = useState(false), [promotions, setPromotions] = useState(true), [promotionsConfirmed, setPromotionsConfirmed] = useState(false)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const returnTo = signupDestination(params.get('next')), puppy = returnTo.startsWith('/p/')
  // The landing CTA's choice ("…as a Breeder" / "…as a Dog Owner") arrives as
  // ?role= and becomes the editable default; plain /signup stays Pet owner.
  const [role, setRole] = useState<'owner' | 'breeder'>(params.get('role') === 'breeder' ? 'breeder' : 'owner')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('Please enter a user name.'); return }
    if (password.length < 8) { setError('Please choose a password with at least 8 characters.'); return }
    if (!agreed) { setError('Please agree to the Terms & Conditions to create your account.'); return }
    setLoading(true); setError('')
    try {
      await signup({ email: email.trim(), password, ...splitDisplayName(name), kennelName: '', role, marketingOptIn: promotions && promotionsConfirmed, termsAccepted: true })
      toast('Welcome to iDogs!')
      navigate(`/verify-email?next=${encodeURIComponent(returnTo)}`, { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(message.includes('email-already-in-use') ? 'This email already has an account. Sign in or reset your password below.'
        : message.includes('weak-password') ? 'Please choose a stronger password with at least 8 characters.'
        : message.includes('invalid-email') ? 'Please check the email address.'
        : message.includes('network-request-failed') ? 'No connection. Check your internet and try again.'
        : 'Could not create your account. Please try again.')
    } finally { setLoading(false) }
  }

  return <AuthLayout title={puppy ? 'Keep their story close' : 'Welcome to iDogs'} description={puppy ? 'Save this dog’s profile to find it again. You can keep viewing shared photos and records without an account.' : 'A place for your dog’s photos, memories and important records. Create your free account and make yourself at home.'} backTo={puppy ? returnTo.split('?')[0] : '/'} backLabel={puppy ? 'Back to dog profile' : 'Back to iDogs'}>
    <div className="idogs-auth-tabs" aria-label="Choose how to register"><button type="button" aria-pressed={method === 'email'} disabled={loading} onClick={() => { setMethod('email'); setError('') }}>Email</button><button type="button" aria-pressed={method === 'phone'} disabled={loading} onClick={() => { setMethod('phone'); setError('') }}>Mobile number</button></div>
    {method === 'email' ? <form className="idogs-auth-form" onSubmit={submit}>
      <fieldset className="idogs-auth-role" disabled={loading} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>I am a</legend>
        <div className="idogs-auth-tabs" style={{ marginBottom: 0 }}>
          <button type="button" aria-pressed={role === 'owner'} onClick={() => setRole('owner')}>Pet owner</button>
          <button type="button" aria-pressed={role === 'breeder'} onClick={() => setRole('breeder')}>Breeder</button>
        </div>
      </fieldset>
      <label>User name<input className="form-input" autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} required maxLength={120} disabled={loading} placeholder="What should we call you?" /></label>
      <label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} placeholder="you@example.com" /></label>
      <label>Password<span className="idogs-auth-password"><input className="form-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required disabled={loading} placeholder="At least 8 characters" /><button className="btn btn-secondary" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Show'}</button></span></label>
      <SignupConsent agreed={agreed} onAgree={setAgreed} promotions={promotions} onPromotions={value => { setPromotions(value); setPromotionsConfirmed(true) }} promotionsConfirmed={promotionsConfirmed} busy={loading} />
      {error && <p role="alert" className="idogs-auth-error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Creating your account…' : 'Create free account'}</button>
    </form> : <MobileNumberUnavailable onUseEmail={() => setMethod('email')} />}
    <p className="idogs-auth-small">No payment details needed. Add other details later, when you need them.</p>
    <p className="idogs-auth-small">{DATA_PROCESSING_SUMMARY}</p>
    {method === 'email' && <p className="idogs-auth-small">We’ll email you a verification link when you sign up.</p>}
    <p className="idogs-auth-switch">Already have an account? <Link to={`/login?next=${encodeURIComponent(returnTo)}`}>Sign in</Link><br /><Link to="/forgot-password">Forgot password?</Link></p>
  </AuthLayout>
}
