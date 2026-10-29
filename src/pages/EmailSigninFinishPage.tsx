import { useRef, useState, type FormEvent } from 'react'
import { getAdditionalUserInfo, isSignInWithEmailLink, signInWithEmailLink, type UserCredential } from 'firebase/auth'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { auth } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { PENDING_SIGNIN_PREFIX, readPendingSignin } from '../lib/passwordless'
import { signupDestination } from '../lib/quickSignup'
import { trackCompletedRegistration } from '../lib/metaPixel'
export default function EmailSigninFinishPage() {
  const [params] = useSearchParams(), navigate = useNavigate(), { finishQuickSignIn } = useAuth()
  const [pending] = useState(() => readPendingSignin(params.get('flow')))
  const [email, setEmail] = useState(pending?.email || ''), [name, setName] = useState(pending?.name || ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const completed = useRef<UserCredential | null>(null)
  const next = signupDestination(params.get('next')), valid = isSignInWithEmailLink(auth, location.href)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try {
      const result = completed.current || await signInWithEmailLink(auth, email.trim(), location.href)
      completed.current = result
      const isNew = getAdditionalUserInfo(result)?.isNewUser === true
      await finishQuickSignIn(result.user, isNew, name, pending?.marketingOptIn === true)
      if (isNew) trackCompletedRegistration()
      try { localStorage.removeItem(PENDING_SIGNIN_PREFIX + params.get('flow')) } catch { /* Optional local state. */ }
      navigate(next, { replace: true })
    } catch { setError(completed.current ? 'Your sign-in worked, but we could not finish loading your account. Please try again.' : 'This link may have expired, been used, or belong to a different email. Check your email or request a new link.') }
    finally { setBusy(false) }
  }
  return <main style={{ maxWidth: 440, margin: '48px auto', padding: 24 }}><h1>Continue to iDogs</h1><p>{pending ? 'Your sign-in link is ready. Continue to your dog’s story.' : 'Enter the email address that received this link to sign in securely.'}</p>
    {valid || completed.current ? <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
      <label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy || !!completed.current} /></label>
      {!pending && <label>Your name (optional)<input className="form-input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} disabled={busy} /></label>}
      <p style={{ fontSize: 12 }}>By continuing, you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</p>
      {error && <p role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Continue to iDogs'}</button>
    </form> : <p role="alert">This is not a valid sign-in link.</p>}
    <p><Link to={`/login?next=${encodeURIComponent(next)}`}>Request a new sign-in link</Link></p>
  </main>
}
