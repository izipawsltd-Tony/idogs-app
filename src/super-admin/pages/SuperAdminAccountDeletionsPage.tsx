import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface QueueRow { uid: string; status: string; requestedAt: string }
interface Inventory { complete: boolean; reason: string; dogQueryTruncated: boolean; billingReviewRequired: boolean; dogs: { id: string; disposition: string }[] }

export default function SuperAdminAccountDeletionsPage() {
  const { user } = useAuth()
  const [requests, setRequests] = useState<QueueRow[] | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load(uid = '') {
    if (!user || busy) return
    setBusy(true); setError(''); setInventory(null); setSelected(uid)
    try {
      const response = await fetch(`/api/super-admin/account-deletions${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      })
      if (!response.ok) throw new Error('Unable to load account deletion requests. Check access and retry.')
      const data = await response.json()
      if (uid) setInventory(data.inventory)
      else setRequests(data.requests)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load requests.') }
    finally { setBusy(false) }
  }
  return <div>
    <h1>Account deletion requests</h1>
    <p>Review requests and ownership safeguards. Permanent deletion is not enabled by this screen.</p>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load()}>Refresh queue</button>
    {busy && <p role="status">Loading…</p>}
    {error && <p role="alert">{error}</p>}
    {requests && <>
      <p>Showing up to 100 active requests. A full page may not include every request.</p>
      {requests.length === 0 ? <p>No active requests.</p> : <ul>{requests.map(item => <li key={item.uid} style={{ marginBottom: 16 }}>
        <strong>{item.uid}</strong> — {item.status} — {item.requestedAt}{' '}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load(item.uid)}>Inspect ownership</button>
      </li>)}</ul>}
    </>}
    {inventory && <section aria-label="Deletion safeguards">
      <h2>Review: {selected}</h2>
      <p>{inventory.reason}</p>
      <p>Billing review: {inventory.billingReviewRequired ? 'Required' : 'No profile billing identifiers found; provider verification still required'}</p>
      {inventory.dogQueryTruncated && <p role="alert">Dog inventory is truncated. Do not process deletion.</p>}
      <ul>{inventory.dogs.map(dog => <li key={dog.id}>{dog.id}: {dog.disposition.replaceAll('_', ' ')}</li>)}</ul>
    </section>}
  </div>
}
