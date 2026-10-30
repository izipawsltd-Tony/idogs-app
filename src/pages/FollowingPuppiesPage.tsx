import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { puppyUpdates, puppyPath, type FollowedPuppy } from '../lib/puppyUpdates'
import { useAuth } from '../hooks/useAuth'
import './following-puppies.css'

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
  return <div className="following-page"><header className="following-header"><div><span className="following-eyebrow">THEIR STORY, SAVED</span><h1>Following puppies</h1><p>A little closer to the puppies you love. Find their photos, shared records and latest adventures here.</p></div>{!loading && !error && <span className="following-count">{puppies.length} following</span>}</header>
    {loading && <div className="following-loading" role="status">Loading your saved puppy profiles…</div>}
    {error && <div className="following-error" role="alert"><span>We couldn’t load your puppies. Please try again.</span><button className="btn btn-secondary" onClick={() => setRetry(v => v + 1)}>Try again</button></div>}
    {!loading && !error && !puppies.length && <section className="following-empty"><div className="following-icon" aria-hidden="true">🐾</div><h2>Your puppy’s story starts here</h2><p>Found a puppy you’d love to follow? Open the QR or profile link shared by their breeder. Save it once, then come back here for their latest moments.</p><div className="following-steps"><div className="following-step"><span>1</span><h3>Open their profile</h3><p>Scan the puppy’s QR with your phone camera, or open the breeder’s link.</p></div><div className="following-step"><span>2</span><h3>Choose Follow</h3><p>Tap Follow this puppy to keep their profile in your account.</p></div><div className="following-step"><span>3</span><h3>Watch their story grow</h3><p>Return here for shared photos, videos and records, before and after handover.</p></div></div><Link className="btn btn-primary" to="/app/dogs">Go to My Dogs</Link><p className="following-note">Following saves a profile. It does not reserve a puppy or transfer ownership.</p></section>}
    {!loading && !error && !!puppies.length && <div className="following-grid">{puppies.map(puppy => <Link key={puppy.passportId} className="following-puppy" to={puppyPath(puppy.passportId)}><span className="following-puppy-icon" aria-hidden="true">🐾</span><div><strong>{puppy.name}</strong><p>{puppy.breed}</p><small>View their story →</small></div></Link>)}</div>}
    <aside className="following-handover"><div><h2>Bringing your puppy home?</h2><p>When your breeder sends an ownership invitation, you can review it here. Your puppy’s profile stays with them as they become part of your family.</p></div><Link className="btn btn-secondary" to="/app/claim-dogs">Review invitations →</Link></aside>
  </div>
}
