import { useEffect, useRef, useState } from 'react'
import type { Dog } from '../../types'
import { buyerRequest, buyerStageLabels, type BuyerContact, type BuyerStage } from '../../lib/buyers'

export default function BuyerForm({ contact, dogs, saved, cancel }: { contact?: BuyerContact; dogs: Dog[]; saved: () => void; cancel: () => void }) {
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { form.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [])
  const [name, setName] = useState(contact?.name || ''), [email, setEmail] = useState(contact?.email || ''), [phone, setPhone] = useState(contact?.phone || '')
  const [status, setStatus] = useState<BuyerStage>(contact?.status || 'waiting'), [dogId, setDogId] = useState(contact?.status === 'transferred' ? '' : contact?.dogId || ''), [amount, setAmount] = useState(contact?.amount?.toString() || ''), [notes, setNotes] = useState(contact?.notes || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await buyerRequest({ action: 'save', name, email, phone, status, dogId, amount, notes }); saved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save buyer.') }
    finally { setBusy(false) }
  }
  return <form ref={form} onSubmit={submit} className="card" aria-label={contact ? 'Edit buyer' : 'Add buyer'} style={{ marginTop: 16 }}>
    <h2 style={{ marginTop: 0 }}>{contact ? 'Edit buyer' : 'Add buyer'}</h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16 }}>
      <label>Name<input className="form-input" value={name} onChange={e => setName(e.target.value)} required maxLength={120} autoComplete="name" disabled={busy} /></label>
      <label>Email<input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="email" disabled={busy || !!contact?.id} /></label>
      <label>Phone (optional)<input className="form-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} autoComplete="tel" disabled={busy} /></label>
      <label>Buyer status<select className="form-input" value={status} onChange={e => { setStatus(e.target.value as BuyerStage); if (e.target.value === 'transferred') setDogId('') }} disabled={busy}>{Object.entries(buyerStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {status !== 'transferred' && <label>Puppy {['reserved', 'deposit'].includes(status) ? '' : '(optional)'}<select className="form-input" value={dogId} onChange={e => setDogId(e.target.value)} required={['reserved', 'deposit'].includes(status)} disabled={busy}><option value="">Choose a puppy</option>{dogs.map(dog => <option key={dog.id} value={dog.id}>{dog.name || 'Unnamed puppy'}</option>)}</select></label>}
      {['reserved', 'deposit'].includes(status) && <label>Deposit amount (AUD, optional)<input className="form-input" type="number" min="0" max="1000000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} /></label>}
    </div>
    {status === 'deposit' && <p style={{ color: 'var(--mid)' }}>Records a deposit already received; no payment is taken. To share private updates, grant buyer access in the puppy’s Timeline.</p>}
    {status === 'transferred' && <p style={{ color: 'var(--mid)' }}>Records a past buyer only. To transfer a puppy’s ownership, open its profile and choose Transfer.</p>}
    <label style={{ display: 'block', marginTop: 16 }}>Notes (private)<textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} rows={3} disabled={busy} /></label>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save buyer'}</button><button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>Cancel</button></div>
  </form>
}
