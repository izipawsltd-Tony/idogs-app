import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { puppyUpdates, puppyAppPath, type FollowedPuppy } from '../lib/puppyUpdates'
import { useAuth } from '../hooks/useAuth'

export default function FollowingPuppiesPage() {
  const { user } = useAuth()
  const [puppies, setPuppies] = useState<FollowedPuppy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setPuppies([]); setError('')
    puppyUpdates<{ puppies: FollowedPuppy[] }>({ action: 'list' }).then(data => { if (active) setPuppies(data.puppies) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user?.uid, retry])
  return <div style={{ maxWidth: 900, margin: '0 auto' }}><h1>Following puppies</h1><p style={{ color: 'var(--mid)' }}>Their story starts here. Follow updates before deposit, through handover and beyond.</p>
    {loading && <div className="spinner" />}{error && <p role="alert">{error} <button className="btn btn-secondary" onClick={() => setRetry(v => v + 1)}>Retry</button></p>}
    {!loading && !error && !puppies.length && <div className="card" style={{ padding: 24 }}>Open a puppy’s QR or profile link and choose <strong>Follow this puppy</strong> to save it here. Following does not reserve a puppy or transfer ownership.</div>}
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>{puppies.map(puppy => <Link key={puppy.passportId} className="card" to={puppyAppPath(puppy.passportId)} style={{ padding: 20, textDecoration: 'none', color: 'var(--dark)' }}><strong>🐾 {puppy.name}</strong><p style={{ margin: '4px 0 12px', fontSize: 13 }}>{puppy.breed}</p><span style={{ color: 'var(--brand-600)' }}>Open photos &amp; updates →</span></Link>)}</div>
    <p style={{ marginTop: 24 }}><Link to="/app/claim-dogs">Ready for handover? Review your ownership invitations</Link></p>
  </div>
}
