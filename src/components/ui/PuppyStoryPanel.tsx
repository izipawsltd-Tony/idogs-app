import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { puppyUpdates, puppyPath, puppyAppPath, type PuppyStory } from '../../lib/puppyUpdates'
import PuppyUpdateFeed from './PuppyUpdateFeed'

function PuppyStoryContent({ passportId }: { passportId: string }) {
  const { user, loading: authLoading } = useAuth()
  const [story, setStory] = useState<PuppyStory | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [loadedFor, setLoadedFor] = useState('')
  const identityKey = `${passportId}:${user?.uid || 'public'}`
  const load = useCallback(() => setRefresh(value => value + 1), [])
  useEffect(() => {
    if (authLoading) return
    let active = true
    setStory(null); setError('')
    puppyUpdates({ passportId, action: 'view' }).then(data => { if (active) { setStory(data); setLoadedFor(identityKey) } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [passportId, user?.uid, authLoading, refresh, identityKey])
  const next = encodeURIComponent(puppyAppPath(passportId))
  async function follow() {
    setBusy(true); setError('')
    try { await puppyUpdates({ passportId, action: story?.following ? 'unfollow' : 'follow' }); load() } catch (e) { setError(e instanceof Error ? e.message : 'Please retry') } finally { setBusy(false) }
  }
  async function older() {
    if (!story?.nextCursor) return
    setBusy(true); setError('')
    try {
      const data = await puppyUpdates({ passportId, action: 'view', cursor: story.nextCursor })
      setStory(previous => previous ? { ...data, updates: [...previous.updates, ...data.updates] } : data)
    } catch (e) { setError(e instanceof Error ? e.message : 'Please retry') } finally { setBusy(false) }
  }
  const visibleStory = !authLoading && loadedFor === identityKey ? story : null
  return <section aria-label="Puppy story" style={{ padding: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><h2 style={{ fontSize: 20, margin: 0 }}>Photos &amp; life updates</h2><button className="btn btn-ghost btn-sm" onClick={load}>Refresh updates</button></div>
    <p style={{ fontSize: 13, color: 'var(--mid)', margin: '8px 0 16px' }}>One puppy, one profile — from first hello to life at home. Keep this QR or link.</p>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {!visibleStory && !error && <div className="spinner" />}
    {visibleStory && story && <>
      {story.role === 'owner' ? <Link className="btn btn-primary" to={`/app/dogs/${story.dogId}`} style={{ marginBottom: 16 }}>Manage {story.dog.name}</Link>
        : user ? <button className="btn btn-primary" disabled={busy} onClick={() => void follow()} style={{ marginBottom: 16 }}>{story.following ? '✓ Following · Unfollow' : 'Follow this puppy'}</button>
          : <div style={{ background: 'var(--brand-50)', padding: 14, borderRadius: 12, marginBottom: 16 }}><strong>Save this puppy’s story</strong><p style={{ fontSize: 13, margin: '6px 0 12px' }}>Create a free account to find this puppy again in Following puppies. No app download needed.</p><Link className="btn btn-primary" to={`/signup?next=${next}`}>Follow with a free account</Link> <Link to={`/login?next=${next}`} style={{ fontSize: 13 }}>Sign in</Link></div>}
      {story.role === 'buyer' && <p style={{ fontSize: 13, color: 'var(--brand-600)' }}>🔒 Your deposited puppy’s private updates. Ownership remains with the breeder until handover.</p>}
      {story.role === 'public' && user && <p style={{ fontSize: 12, color: 'var(--mid)' }}>Following saves the profile. Private updates require the breeder to grant access to your verified email after deposit.</p>}
      <PuppyUpdateFeed updates={story.updates} />
      {story.nextCursor && <button className="btn btn-secondary" disabled={busy} onClick={() => void older()}>Load older updates</button>}
      <p style={{ fontSize: 12, color: 'var(--mid)', marginTop: 16 }}>Looking for recent photos? Refresh to load new updates and renew media access. <Link to={puppyPath(passportId)}>Keep this profile link</Link>.</p>
    </>}
  </section>
}

export default function PuppyStoryPanel({ passportId }: { passportId: string }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="spinner" />
  return <PuppyStoryContent key={`${passportId}:${user?.uid || 'public'}`} passportId={passportId} />
}
