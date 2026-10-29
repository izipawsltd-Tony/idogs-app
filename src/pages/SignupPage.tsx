import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'
import { signupDestination } from '../lib/quickSignup'
import { trackCompletedRegistration } from '../lib/metaPixel'
import SocialSignIn from '../components/ui/SocialSignIn'
import PasswordlessSignIn from '../components/ui/PasswordlessSignIn'
interface Props { toast: (msg: string, type?: ToastMessage['type']) => void }
export default function SignupPage({ toast }: Props) {
  const { socialLogin } = useAuth(), navigate = useNavigate()
  const [params] = useSearchParams(), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const returnTo = signupDestination(params.get('next')), puppy = returnTo.startsWith('/app/puppy-updates/')
  async function social(provider: 'google.com' | 'facebook.com') {
    setLoading(true); setError('')
    try { const created = await socialLogin(provider); if (created) { trackCompletedRegistration(); toast('Welcome to iDogs!') }; navigate(returnTo, { replace: true }) }
    catch { setError('Could not sign in with this provider. Try your existing sign-in method or continue with email.') }
    finally { setLoading(false) }
  }
  return <div style={{ minHeight: '100dvh', background: 'var(--sand)', padding: '32px 16px' }}><div style={{ maxWidth: 440, margin: '0 auto' }}>
    <div style={{ textAlign: 'center', marginBottom: 24 }}><Link to="/"><img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ width: 190, height: 62, objectFit: 'contain' }} /></Link></div>
    <section className="card" style={{ padding: '28px 24px' }}><h1 style={{ fontSize: 26, margin: '0 0 8px' }}>{puppy ? 'Keep their story close' : 'Welcome to iDogs'}</h1><p style={{ color: 'var(--mid)', margin: '0 0 20px' }}>{puppy ? 'Create your free account to follow this puppy. No app download needed.' : 'Keep your dog’s photos, memories and important moments together. Start with a free account.'}</p>
      <p style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.6 }}>By creating an account or continuing with a provider, you agree to our <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</p>
      <SocialSignIn busy={loading} onContinue={social} />
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      <PasswordlessSignIn next={returnTo} signup />
      <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 0 }}>No password or card needed. Add details later, when you need them.</p>
    </section><p style={{ textAlign: 'center' }}>Already have an account? <Link to={`/login?next=${encodeURIComponent(returnTo)}`}>Sign in</Link></p><p style={{ textAlign: 'center' }}><Link to={puppy ? `/p/${encodeURIComponent(returnTo.split('/').slice(-1)[0].split('?')[0])}` : '/'}>Continue browsing</Link></p>
  </div></div>
}
