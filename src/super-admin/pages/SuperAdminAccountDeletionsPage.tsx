import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface QueueRow { uid: string; status: string; requestedAt: string; revision: number }
interface Inventory { complete: boolean; reason: string; truncated: string[]; holds: string[]; fingerprint: string; counts: { records: number }; billingReviewRequired: boolean; dogs: { id: string; disposition: string }[] }

export default function SuperAdminAccountDeletionsPage() {
  const { user } = useAuth()
  const [requests, setRequests] = useState<QueueRow[] | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [emulatorProcessing, setEmulatorProcessing] = useState(false)
  async function processSynthetic(item: QueueRow) {
    if (!user || busy || !emulatorProcessing) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/super-admin/account-deletions', {method:'POST',headers:{Authorization:`Bearer ${await user.getIdToken()}`,'Content-Type':'application/json'},body:JSON.stringify({action:'process',uid:item.uid,revision:item.revision})})
      const data = await response.json()
      if (!response.ok) throw new Error('Synthetic processing did not complete. Refresh the queue before retrying.')
      if (data.status !== 'completed') setError('A safeguard is holding this synthetic request. Refresh its status for review.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Synthetic processing failed.') }
    finally { setBusy(false) }
  }
  async function load(uid = '') {
    if (!user || busy) return
    setBusy(true); setError(''); setInventory(null); setSelected(uid)
    try {
      const response = await fetch(`/api/super-admin/account-deletions${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      })
      if (!response.ok) throw new Error('Unable to load account deletion requests. Check access and retry.')
      const data = await response.json()
      setEmulatorProcessing(data.emulatorProcessingAvailable === true)
      if (uid) setInventory(data.inventory)
      else setRequests(data.requests)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load requests.') }
    finally { setBusy(false) }
  }
  return <div>
    <h1>Account deletion requests</h1>
    <p>Review requests and ownership safeguards. Permanent deletion is not enabled by this screen.</p>
    {emulatorProcessing && <p role="note">Local emulator prototype only. Process buttons apply to synthetic fixture accounts; cloud processing remains disabled.</p>}
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load()}>Refresh queue</button>
    {busy && <p role="status">Loading…</p>}
    {error && <p role="alert">{error}</p>}
    {requests && <>
      <p>Showing up to 100 active requests. A full page may not include every request.</p>
      {requests.length === 0 ? <p>No active requests.</p> : <ul>{requests.map(item => <li key={item.uid} style={{ marginBottom: 16 }}>
        <strong>{item.uid}</strong> — {item.status} — {item.requestedAt}{' '}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load(item.uid)}>Inspect ownership</button>
        {emulatorProcessing && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void processSynthetic(item)}>Process synthetic request</button>}
      </li>)}</ul>}
    </>}
    {inventory && <section aria-label="Deletion safeguards">
      <h2>Review: {selected}</h2>
      <p>{inventory.reason}</p>
      <p>Billing review: {inventory.billingReviewRequired ? 'Required' : 'No profile billing identifiers found; provider verification still required'}</p>
      <p>Related records found: {inventory.counts.records}. This count does not confirm a complete inventory.</p>
      <p style={{ overflowWrap: 'anywhere' }}>Inventory fingerprint: {inventory.fingerprint}</p>
      {inventory.truncated.length > 0 && <p role="alert">Inventory is truncated. Do not process deletion.</p>}
      <h3>Outstanding checks</h3>
      <ul>{inventory.holds.map(hold => <li key={hold}>{hold.replaceAll('_', ' ')}</li>)}</ul>
      <ul>{inventory.dogs.map(dog => <li key={dog.id}>{dog.id}: {dog.disposition.replaceAll('_', ' ')}</li>)}</ul>
    </section>}
  </div>
}
