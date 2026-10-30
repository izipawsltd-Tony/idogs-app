import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth } from '../../lib/firebase'
interface SharedDocument { id: string; title: string; url: string }
async function manageDocuments(dogId: string, action: 'manage' | 'save', documentIds?: string[]): Promise<string[]> {
  const token = await auth.currentUser?.getIdToken()
  const response = await fetch('/api/qr-documents', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` }, body: JSON.stringify({ dogId, action, ...(documentIds && { documentIds }) }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save shared documents')
  return data.documentIds
}
interface ManagedDocument { id: string; name?: string; title?: string; filePath?: string; storagePath?: string; documentPath?: string }
const isEligible = (doc: ManagedDocument) => /\.(pdf|jpe?g|png|webp)$/i.test(doc.filePath || doc.storagePath || doc.documentPath || '')
const SharingContext = createContext<{ ids: string[]; loaded: boolean; busy: boolean; error: string; saved: boolean; selectedCount: number; hasDocuments: boolean; toggle: (id: string, checked: boolean) => void; save: () => Promise<void>; retry: () => void } | null>(null)
export function QrDocumentManager({ dogId, documents, enabled = true, children }: { dogId: string; documents: ManagedDocument[]; enabled?: boolean; children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => { if (!enabled) return; let live = true; setLoaded(false); setError(''); manageDocuments(dogId, 'manage').then(value => { if (live) { setIds(value); setLoaded(true) } }).catch(err => { if (live) setError(err.message) }); return () => { live = false } }, [dogId, enabled, refresh])
  async function save() {
    setBusy(true); setError(''); setSaved(false)
    try { setIds(await manageDocuments(dogId, 'save', ids.filter(id => eligible.some(doc => doc.id === id)))); setSaved(true) } catch (err) { setError(err instanceof Error ? err.message : 'Please retry') } finally { setBusy(false) }
  }
  const eligible = documents.filter(isEligible)
  if (!enabled) return <>{children}</>
  return <SharingContext.Provider value={{ ids, loaded, busy, error, saved, selectedCount: ids.filter(id => eligible.some(doc => doc.id === id)).length, hasDocuments: eligible.length > 0 || ids.length > 0, toggle: (id, checked) => { setSaved(false); setIds(previous => checked ? [...new Set([...previous, id])] : previous.filter(value => value !== id)) }, save, retry: () => setRefresh(value => value + 1) }}>{children}</SharingContext.Provider>
}
export function QrDocumentSharingSummary() {
  const sharing = useContext(SharingContext)
  if (!sharing) return null
  return <section style={{ background: '#f3f8f2', border: '1px solid #dae6da', padding: 16, borderRadius: 12, marginBottom: 20 }} aria-label="Share documents on QR profile">
    <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Documents shared on the QR profile</h3><p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>Tick <strong>Share on QR</strong> beside View and Delete on each document below, then save your changes. Anyone with this dog’s QR or link can view and download shared files. Check for personal details first. Other files stay private.</p>
    {!sharing.loaded && !sharing.error && <p role="status" style={{ fontSize: 13 }}>Loading QR sharing settings…</p>}
    {sharing.error && <p role="alert" style={{ color: 'var(--danger)' }}>{sharing.error} {!sharing.loaded && <button type="button" className="btn btn-secondary btn-sm" onClick={sharing.retry}>Retry</button>}</p>}
  </section>
}
export function QrDocumentShareCheckbox({ document }: { document: ManagedDocument }) {
  const sharing = useContext(SharingContext)
  if (!sharing || !isEligible(document)) return null
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 8px', fontSize: 12, cursor: sharing.loaded && !sharing.busy ? 'pointer' : 'default', whiteSpace: 'nowrap' }}><input type="checkbox" aria-label={`Share ${document.name || document.title || 'document'} on QR profile`} checked={sharing.loaded && sharing.ids.includes(document.id)} disabled={!sharing.loaded || sharing.busy} onChange={event => sharing.toggle(document.id, event.target.checked)} style={{ width: 16, height: 16, accentColor: '#287e51', margin: 0 }} />{sharing.loaded ? 'Share on QR' : sharing.error ? 'Sharing unavailable' : 'Loading sharing…'}</label>
}
export function QrDocumentSharingFooter() {
  const sharing = useContext(SharingContext)
  if (!sharing?.loaded || !sharing.hasDocuments) return null
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}><button type="button" className="btn btn-primary btn-sm" disabled={sharing.busy} onClick={() => void sharing.save()}>{sharing.busy ? 'Saving…' : 'Save QR document sharing'}</button><span style={{ fontSize: 12, color: 'var(--mid)' }}>{sharing.selectedCount} selected · Save to apply changes</span>{sharing.saved && <span role="status" style={{ fontSize: 13, color: 'var(--brand-600)' }}>QR document sharing saved.</span>}</div>
}
export default function QrDocuments({ passportId }: { passportId: string }) {
  const [documents, setDocuments] = useState<SharedDocument[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let live = true; setLoading(true); setDocuments([]); setError('')
    fetch(`/api/qr-documents?passportId=${encodeURIComponent(passportId)}`).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load documents'); return data.documents }).then(data => { if (live) setDocuments(data) }).catch(err => { if (live) setError(err.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [passportId, refresh])
  return <section style={{ padding: 20 }} aria-label="Shared documents"><h2 style={{ fontSize: 18, margin: '0 0 10px' }}>Shared documents</h2><p style={{ fontSize: 13, color: 'var(--mid)' }}>Files selected for this QR profile. No sign-in needed.</p>{loading && <p role="status">Loading documents…</p>}{error && <p role="alert">{error} <button className="btn btn-secondary btn-sm" onClick={() => setRefresh(v => v + 1)}>Retry</button></p>}{!loading && !error && (!documents.length ? <p style={{ fontSize: 13, color: 'var(--mid)' }}>No files have been shared on this profile yet.</p> : <div style={{ display: 'grid', gap: 10 }}>{documents.map(doc => <a key={doc.id} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ border: '1px solid #dce6da', borderRadius: 10, padding: 14, color: '#085041', fontSize: 14 }}>{doc.title} ↗</a>)}</div>)}</section>
}
