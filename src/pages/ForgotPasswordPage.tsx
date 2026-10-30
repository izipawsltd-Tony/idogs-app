import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AuthLayout from '../components/ui/AuthLayout'
import { signupDestination } from '../lib/quickSignup'
import { onboardingQaEnabled } from '../lib/accountOnboarding'
export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [params] = useSearchParams(), next = params.get('next')
  const destination = signupDestination(next), loginPath = next ? `/login?next=${encodeURIComponent(destination)}` : '/login'
  const [email, setEmail] = useState(''), [loading, setLoading] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    try { if (next) await resetPassword(email.trim(), destination); else await resetPassword(email.trim()); setSent(true) }
    catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('user-not-found')) setSent(true)
      else setError(message.includes('too-many-requests') ? 'Please wait a few minutes before trying again.' : 'Could not request a reset link. Check your email address and connection, then try again.')
    } finally { setLoading(false) }
  }
  return <AuthLayout title="Reset your password" description="We’ll help you get back to your dog’s story." backTo={loginPath} backLabel="Back to sign in">
    {sent ? <div role="status"><h2 style={{ fontSize: 18 }}>Check your inbox</h2><p className="idogs-auth-small">If this email is registered, you’ll receive a password reset link. Check your junk folder too.</p></div> : <form className="idogs-auth-form" onSubmit={submit}><label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} placeholder="you@example.com" /></label>{error && <p role="alert" className="idogs-auth-error">{error}</p>}<button className="btn btn-primary" disabled={loading}>{loading ? 'Requesting link…' : 'Send reset link'}</button></form>}
    <p className="idogs-auth-switch"><Link to={loginPath}>Back to sign in</Link></p><p className="idogs-auth-small">{onboardingQaEnabled() ? 'Returning mobile customer? Use Existing mobile account to resume setup on the same account. Email and password are your main sign-in.' : 'Using a mobile number? Choose Mobile number on the sign-in page to receive an SMS code. You don’t need a password.'}</p>
  </AuthLayout>
}
