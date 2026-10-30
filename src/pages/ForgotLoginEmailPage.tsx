import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../components/ui/AuthLayout'

class RecoveryUiError extends Error {}

export default function ForgotLoginEmailPage() {
  const enabled = import.meta.env.DEV && import.meta.env.VITE_ACCOUNT_RECOVERY_QA === '1'
  const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [email, setEmail] = useState(''), [incomplete, setIncomplete] = useState(false), [cooldown, setCooldown] = useState(0)
  const device = useRef(''), inFlight = useRef(false), request = useRef<AbortController | null>(null)
  useEffect(() => { device.current = crypto.randomUUID(); return () => request.current?.abort() }, [])
  useEffect(() => { if (cooldown <= 0) return; const timer = setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000); return () => clearTimeout(timer) }, [cooldown])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!enabled || inFlight.current || (!challenge && cooldown > 0)) return
    inFlight.current = true; setBusy(true); setError('')
    request.current = new AbortController()
    try {
      const response = await fetch('/api/account-recovery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: request.current.signal,
        body: JSON.stringify(challenge ? { action: 'verify', challenge, code, device: device.current } : { action: 'start', phone, device: device.current }),
      })
      const result = await response.json()
      if (!response.ok) throw new RecoveryUiError(response.status === 429 ? 'Please wait before requesting another code.' : response.status === 503 ? 'Account recovery is unavailable. Please try again later or contact iDogs support.' : challenge ? 'Could not verify this request. Check the code or request a new one.' : 'Check your Australian mobile number and try again.')
      if (!challenge) {
        if (typeof result.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(result.challenge)) throw new RecoveryUiError('Could not start recovery. Please try again.')
        setChallenge(result.challenge); setCooldown(60)
      } else if (result.status === 'found' && typeof result.email === 'string') setEmail(result.email)
      else if (result.status === 'incomplete') setIncomplete(true)
      else throw new RecoveryUiError('Could not verify this request. Please try again.')
    } catch (err) {
      if (!request.current.signal.aborted) setError(err instanceof RecoveryUiError ? err.message : 'Could not connect. Please try again.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <AuthLayout title="Forgot your login email?" description="Use your linked mobile number to find the email for your iDogs account." backTo="/login" backLabel="Back to sign in">
    {!enabled ? <p role="status">This option is not available yet. Please use your email to sign in or contact iDogs support.</p> : <>
      <p className="idogs-auth-small" role="note" style={{ marginBottom: 16 }}>Local QA only · Synthetic accounts and simulated SMS. No real messages are sent.</p>
      {email ? <div role="status" className="idogs-auth-form"><h2 style={{ fontSize: 18 }}>Your login email</h2><p style={{ overflowWrap: 'anywhere' }}>{email}</p><p className="idogs-auth-small">Sign in with this email and your password. Finding your email does not sign you in.</p><Link className="btn btn-primary" to="/login">Continue to email sign-in</Link><p><Link to="/forgot-password">Forgot password?</Link></p></div> : incomplete ? <div role="status" className="idogs-auth-form"><h2 style={{ fontSize: 18 }}>Finish setting up your account</h2><p className="idogs-auth-small">Your mobile account still needs a verified email and password. Use the existing mobile option to return to that account. Please don’t create another account.</p><Link to="/login">Return to sign in</Link></div> : <form className="idogs-auth-form" onSubmit={submit}>
        {!challenge ? <label>Linked mobile number<input className="form-input" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="04xx xxx xxx or +61…" required disabled={busy} maxLength={40} /></label> : <><p role="status" className="idogs-auth-small">If this number is linked to an eligible account, a code has been sent. Enter it within five minutes.</p><label>Verification code<input className="form-input" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required disabled={busy} /></label></>}
        {error && <p role="alert" className="idogs-auth-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || (!challenge && cooldown > 0)}>{busy ? 'Please wait…' : challenge ? 'Verify code and find email' : cooldown ? `Try again in ${cooldown}s` : 'Send recovery code'}</button>
        {challenge && <button type="button" className="btn btn-secondary" disabled={busy || cooldown > 0} onClick={() => { setChallenge(''); setCode(''); setError('') }}>{cooldown ? `Request another code in ${cooldown}s` : 'Change number or request a new code'}</button>}
        <p className="idogs-auth-small">A contact number saved on a profile may be different from your linked account number. This process will not create an account.</p>
      </form>}
    </>}
  </AuthLayout>
}
