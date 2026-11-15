import { useEffect, useState } from 'react'
export default function SocialSignIn({ busy, onContinue }: { busy: boolean; onContinue: (provider: 'google.com' | 'facebook.com') => void }) {
  const [providers, setProviders] = useState<string[]>([])
  useEffect(() => { let live = true; fetch('/api/auth-options').then(r => r.json()).then(data => { if (live) setProviders(Array.isArray(data.providers) ? data.providers : []) }).catch(() => {}); return () => { live = false } }, [])
  return <>{(['google.com', 'facebook.com'] as const).filter(p => providers.includes(p)).map(provider => <button key={provider} type="button" className="btn btn-secondary" disabled={busy} onClick={() => onContinue(provider)} style={{ width: '100%', minHeight: 48, background: '#fff', marginBottom: 12 }}><strong style={{ marginRight: 12, color: provider === 'google.com' ? '#4285f4' : '#1877f2' }}>{provider === 'google.com' ? 'G' : 'f'}</strong>Continue with {provider === 'google.com' ? 'Google' : 'Facebook'}</button>)}</>
}
