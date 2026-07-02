import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AU_STATES } from '../lib/utils'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function SignupPage({ toast }: Props) {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountType, setAccountType] = useState<'breeder' | 'owner'>('breeder')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [form, setForm] = useState({
    firstName: '', lastName: '', kennelName: '',
    email: '', password: '', confirmPassword: '',
    state: 'NSW', breederNumber: '',
  })

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue.')
      return
    }
    setLoading(true)
    try {
      await signup({
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        kennelName: accountType === 'breeder' ? form.kennelName : `${form.firstName} ${form.lastName}`,
        state: form.state,
        breederNumber: form.breederNumber || undefined,
      })
      toast('Account created! Please check your email to verify your address.')
      navigate('/verify-email')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('email-already-in-use')) {
        setError('This email is already registered. Try signing in.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--sand)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '48px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 460 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
            <img src="/logo.png" alt="iDogs" style={{ height: 72, width: 240, objectFit: 'contain' }} />
          </Link>
          <div style={{ marginTop: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 500, padding: '4px 12px', borderRadius: 20, background: 'var(--gold-light)', color: 'var(--gold)' }}>
              🎉 30-day free trial — no credit card
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: '32px 28px' }}>
          <h1 style={{ fontSize: 22, fontFamily: 'var(--font-display)', marginBottom: 6, color: 'var(--dark)' }}>Create your account</h1>
          <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 24 }}>Sign up in 60 seconds. No credit card required.</p>

          {/* Account type selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
            <button
              type="button"
              onClick={() => setAccountType('breeder')}
              style={{
                padding: '14px 12px',
                borderRadius: 12,
                border: `2px solid ${accountType === 'breeder' ? 'var(--green)' : 'var(--border)'}`,
                background: accountType === 'breeder' ? 'var(--green-light)' : 'var(--white)',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>🏆</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: accountType === 'breeder' ? 'var(--green)' : 'var(--dark)', marginBottom: 2 }}>Breeder</div>
              <div style={{ fontSize: 12, color: 'var(--light)' }}>I breed & sell dogs</div>
            </button>
            <button
              type="button"
              onClick={() => setAccountType('owner')}
              style={{
                padding: '14px 12px',
                borderRadius: 12,
                border: `2px solid ${accountType === 'owner' ? 'var(--green)' : 'var(--border)'}`,
                background: accountType === 'owner' ? 'var(--green-light)' : 'var(--white)',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>🐾</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: accountType === 'owner' ? 'var(--green)' : 'var(--dark)', marginBottom: 2 }}>Pet Owner</div>
              <div style={{ fontSize: 12, color: 'var(--light)' }}>I received a dog</div>
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">First name</label>
                <input className="form-input" type="text" placeholder="Sarah" value={form.firstName} onChange={e => set('firstName', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Last name</label>
                <input className="form-input" type="text" placeholder="Mitchell" value={form.lastName} onChange={e => set('lastName', e.target.value)} required />
              </div>
            </div>

            {/* Kennel name — only for breeders */}
            {accountType === 'breeder' && (
              <div className="form-group">
                <label className="form-label">Kennel / business name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Goldenfields Kennels"
                  value={form.kennelName}
                  onChange={e => set('kennelName', e.target.value)}
                  required
                />
                <span className="form-hint">Your Dogs Australia prefix or kennel trading name</span>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Email address</label>
                <input className="form-input" type="email" placeholder="you@email.com.au" value={form.email} onChange={e => set('email', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">State</label>
                <select className="form-select" style={{ width: 100 }} value={form.state} onChange={e => set('state', e.target.value)}>
                  {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {accountType === 'breeder' && (
              <div className="form-group">
                <label className="form-label">Breeder registration number <span style={{ fontWeight: 400, color: 'var(--light)' }}>(optional)</span></label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. 12345678"
                  value={form.breederNumber}
                  onChange={e => set('breederNumber', e.target.value)}
                />
                <span className="form-hint">e.g. Dogs SA membership no. or NSW BIN — you can add this later in Settings</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="Minimum 8 characters" value={form.password} onChange={e => set('password', e.target.value)} required minLength={8} />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} required />
            </div>

            {error && (
              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 13, color: 'var(--error)' }}>
                {error}
              </div>
            )}

            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--green-light)', fontSize: 12, color: 'var(--green)' }}>
              🇦🇺 Your data is stored securely in Asia-Pacific and is fully compliant with the Australian Privacy Act 1988.
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 48, fontSize: 15, marginTop: 4, opacity: !agreedToTerms ? 0.6 : 1 }} disabled={loading || !agreedToTerms}>
              {loading ? <span className="spinner" /> : 'Create account — free for 30 days'}
            </button>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, background: agreedToTerms ? 'var(--green-light)' : 'var(--sand)', border: `1px solid ${agreedToTerms ? 'rgba(8,80,65,0.15)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={e => setAgreedToTerms(e.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: 'var(--green)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.6 }}>
                I have read and agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', fontWeight: 600 }}>Terms of Service</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', fontWeight: 600 }}>Privacy Policy</a>.
                {' '}I understand my data will be stored securely in Asia-Pacific in compliance with the Australian Privacy Act 1988.
              </span>
            </label>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--mid)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--green)', fontWeight: 500, textDecoration: 'none' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
