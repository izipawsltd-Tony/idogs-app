import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { puppyUpdates, puppyPath, type PuppyStory } from '../../lib/puppyUpdates'
import PuppyUpdateFeed from './PuppyUpdateFeed'

function PuppyStoryContent({ passportId }: { passportId: string }) {
  const { user, loading: authLoading } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
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
  const next = encodeURIComponent(puppyPath(passportId) + '?follow=1')
  async function allowFollowing() {
    if (import.meta.env.VITE_ACCOUNT_ONBOARDING_QA === '1' && user) {
      const { accountSetupRequest } = await import('../../lib/accountOnboarding')
      if (!(await accountSetupRequest(user)).ready) {
        navigate(`/complete-account?next=${next}`)
        return false
      }
    }
    return true
  }
  async function follow() {
    setBusy(true); setError('')
    try { if (!await allowFollowing()) return; await puppyUpdates({ passportId, action: story?.following ? 'unfollow' : 'follow' }); load() } catch (e) { setError(e instanceof Error ? e.message : 'Please retry') } finally { setBusy(false) }
  }
  useEffect(() => {
    if (!user || !story || loadedFor !== identityKey || params.get('follow') !== '1') return
    let live = true
    if (story.following) { const next = new URLSearchParams(params); next.delete('follow'); setParams(next, { replace: true }); return }
    setBusy(true)
    ;(async () => { if (!await allowFollowing()) return false; await puppyUpdates({ passportId, action: 'follow' }); return true })().then(completed => { if (live && completed) { setBusy(false); const next = new URLSearchParams(params); next.delete('follow'); setParams(next, { replace: true }); load() } }).catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [user?.uid, loadedFor, identityKey, params.get('follow'), passportId])
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
      <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>{story.dog.name} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--mid)' }}>{story.dog.breed}</span></h3>
      {story.role === 'owner' ? <Link className="btn btn-primary" to={`/app/dogs/${story.dogId}`} style={{ marginBottom: 16 }}>Manage {story.dog.name}</Link>
        : user && <button className="btn btn-primary" disabled={busy} onClick={() => void follow()} style={{ marginBottom: 16 }}>{story.following ? '✓ Following · Unfollow' : 'Follow this puppy'}</button>}
      {story.role === 'buyer' && <p style={{ fontSize: 13, color: 'var(--brand-600)' }}>🔒 Your deposited puppy’s private updates. Ownership remains with the breeder until handover.</p>}
      {story.role === 'public' && user && <p style={{ fontSize: 12, color: 'var(--mid)' }}>Following saves the profile. Private updates require the breeder to grant access to your verified email after deposit.</p>}
      <PuppyUpdateFeed updates={story.updates} />
      {story.nextCursor && <button className="btn btn-secondary" disabled={busy} onClick={() => void older()}>Load older updates</button>}
      {!user ? <aside style={{ background: '#f3f8f2', padding: 16, borderRadius: 14, marginTop: 20 }}><strong>Want to keep this story close?</strong><p style={{ fontSize: 13, lineHeight: 1.6, margin: '6px 0 12px' }}>You can view the shared photos and records without signing in. A free account saves this profile in Following puppies and gives you your own account settings.</p><Link className="btn btn-primary" to={`/signup?next=${next}`}>Save this puppy’s story</Link><p style={{ fontSize: 13, marginBottom: 0 }}>Already have an account? <Link to={`/login?next=${next}`}>Sign in</Link></p></aside> : <p style={{ fontSize: 13 }}><Link to="/app/settings">My account &amp; Settings</Link> · <Link to="/app/following-puppies">Following puppies</Link></p>}
      <p style={{ fontSize: 12, color: 'var(--mid)', marginTop: 16 }}>Looking for recent photos? Refresh to load new updates and renew media access. <Link to={puppyPath(passportId)}>Keep this profile link</Link>.</p>
    </>}
  </section>
}

export default function PuppyStoryPanel({ passportId }: { passportId: string }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="spinner" />
  return <PuppyStoryContent key={`${passportId}:${user?.uid || 'public'}`} passportId={passportId} />
}
