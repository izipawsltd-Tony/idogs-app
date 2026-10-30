import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
const SharingContext = createContext<{ ids: string[]; loaded: boolean; busy: boolean; error: string; saved: boolean; activeId: string; selectedCount: number; hasDocuments: boolean; toggle: (id: string, checked: boolean) => Promise<void>; retry: () => void } | null>(null)
export function QrDocumentManager({ dogId, documents, enabled = true, children }: { dogId: string; documents: ManagedDocument[]; enabled?: boolean; children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [refresh, setRefresh] = useState(0)
  const [activeId, setActiveId] = useState('')
  const saving = useRef(false)
  useEffect(() => { if (!enabled) return; let live = true; setLoaded(false); setError(''); manageDocuments(dogId, 'manage').then(value => { if (live) { setIds(value); setLoaded(true) } }).catch(err => { if (live) setError(err.message) }); return () => { live = false } }, [dogId, enabled, refresh])
  const eligible = documents.filter(isEligible)
  async function toggle(id: string, checked: boolean) {
    if (!loaded || saving.current || !enabled || !eligible.some(doc => doc.id === id)) return
    const previous = ids
    const next = (checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)).filter(value => eligible.some(doc => doc.id === value))
    saving.current = true
    setIds(next); setActiveId(id); setBusy(true); setError(''); setSaved(false)
    try {
      setIds(await manageDocuments(dogId, 'save', next))
      setSaved(true)
    } catch (err) {
      setIds(previous)
      setError((err instanceof Error ? err.message : 'Could not save sharing') + '. Please try again or refresh to check the saved setting.')
    } finally { saving.current = false; setBusy(false) }
  }
  if (!enabled) return <>{children}</>
  return <SharingContext.Provider value={{ ids, loaded, busy, error, saved, activeId, selectedCount: ids.filter(id => eligible.some(doc => doc.id === id)).length, hasDocuments: eligible.length > 0 || ids.length > 0, toggle, retry: () => setRefresh(value => value + 1) }}>{children}</SharingContext.Provider>
}
export function QrDocumentSharingSummary() {
  const sharing = useContext(SharingContext)
  if (!sharing) return null
  return <section style={{ background: '#f3f8f2', border: '1px solid #dae6da', padding: 16, borderRadius: 12, marginBottom: 20 }} aria-label="Share documents on QR profile">
    <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Documents shared on the QR profile</h3><p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 0 }}>Tick <strong>Share on QR</strong> beside a document to share it, or untick to stop sharing. Changes save automatically — wait for Saved before leaving. Anyone with this dog’s QR or link can view and download shared files. Check for personal details first. Other files stay private.</p>
    {!sharing.loaded && !sharing.error && <p role="status" style={{ fontSize: 13 }}>Loading QR sharing settings…</p>}
    {sharing.error && <p role="alert" style={{ color: 'var(--danger)' }}>{sharing.error} {!sharing.loaded && <button type="button" className="btn btn-secondary btn-sm" onClick={sharing.retry}>Retry</button>}</p>}
  </section>
}
export function QrDocumentShareCheckbox({ document }: { document: ManagedDocument }) {
  const sharing = useContext(SharingContext)
  if (!sharing || !isEligible(document)) return null
  return <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 8px', fontSize: 12, cursor: sharing.loaded && !sharing.busy ? 'pointer' : 'default', whiteSpace: 'nowrap' }}><input type="checkbox" aria-label={`Share ${document.name || document.title || 'document'} on QR profile`} checked={sharing.loaded && sharing.ids.includes(document.id)} disabled={!sharing.loaded || sharing.busy} onChange={event => void sharing.toggle(document.id, event.target.checked)} style={{ width: 16, height: 16, accentColor: '#287e51', margin: 0 }} />{sharing.loaded ? 'Share on QR' : sharing.error ? 'Sharing unavailable' : 'Loading sharing…'}</label>{sharing.activeId === document.id && <span role="status" style={{ fontSize: 11, color: sharing.error ? 'var(--danger)' : 'var(--brand-600)' }}>{sharing.busy ? 'Saving…' : sharing.saved ? 'Saved' : 'Not saved'}</span>}</div>
}
export function QrDocumentSharingFooter() {
  const sharing = useContext(SharingContext)
  if (!sharing?.loaded || !sharing.hasDocuments) return null
  return <p style={{ fontSize: 12, color: 'var(--mid)', marginTop: 16 }}>{sharing.selectedCount} selected · Sharing changes save automatically.</p>
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
