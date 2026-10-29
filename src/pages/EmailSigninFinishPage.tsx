import { useEffect, useRef, useState, type FormEvent } from 'react'
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
  const [email, setEmail] = useState(pending?.email || ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const completed = useRef<UserCredential | null>(null)
  const signing = useRef(false), autoAttempted = useRef(false)
  const next = signupDestination(params.get('next')), valid = isSignInWithEmailLink(auth, location.href)
  useEffect(() => {
    if (valid && pending && !autoAttempted.current) {
      autoAttempted.current = true
      void complete()
    }
  }, [valid, pending])
  async function complete() {
    if (signing.current) return
    signing.current = true; setBusy(true); setError('')
    try {
      const result = completed.current || await signInWithEmailLink(auth, email.trim(), location.href)
      completed.current = result
      const isNew = getAdditionalUserInfo(result)?.isNewUser === true
      await finishQuickSignIn(result.user, isNew, pending?.name || '', pending?.marketingOptIn === true)
      if (isNew) trackCompletedRegistration()
      try { localStorage.removeItem(PENDING_SIGNIN_PREFIX + params.get('flow')) } catch { /* Optional local state. */ }
      navigate(next, { replace: true })
    } catch { setError(completed.current ? 'Your sign-in worked, but we could not finish loading your account. Please try again.' : 'This link may have expired, been used, or belong to a different email. Check your email or request a new link.') }
    finally { signing.current = false; setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void complete() }
  const automatic = valid && !!pending && !error
  return <main style={{ maxWidth: 440, margin: '48px auto', padding: 24 }}><h1>{automatic ? 'Signing you in…' : 'Continue to iDogs'}</h1>
    {automatic ? <p role="status">Taking you back to your dog’s story. No need to enter your details again.</p> : <>
      {!pending && valid && <p>This link opened in a different browser, or your saved sign-in details are unavailable. Confirm the email that received it — you don’t need to enter your name again.</p>}
      {valid || completed.current ? <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        {!pending && <label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy || !!completed.current} /></label>}
        {error && <p role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : pending ? 'Try signing in again' : 'Continue to iDogs'}</button>
      </form> : <p role="alert">This is not a valid sign-in link.</p>}
    </>}
    <p><Link to={`/login?next=${encodeURIComponent(next)}`}>Request a new sign-in link</Link></p>
  </main>
}
