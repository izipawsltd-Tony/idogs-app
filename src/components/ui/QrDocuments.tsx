import { useEffect, useState } from 'react'
import { auth } from '../../lib/firebase'
interface SharedDocument { id: string; title: string; url: string }
async function manageDocuments(dogId: string, action: 'manage' | 'save', documentIds?: string[]): Promise<string[]> {
  const token = await auth.currentUser?.getIdToken()
  const response = await fetch('/api/qr-documents', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` }, body: JSON.stringify({ dogId, action, ...(documentIds && { documentIds }) }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save shared documents')
  return data.documentIds
}
export function QrDocumentManager({ dogId, documents }: { dogId: string; documents: { id: string; name?: string; title?: string; filePath?: string; storagePath?: string; documentPath?: string }[] }) {
  const [ids, setIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => { let live = true; setLoaded(false); setError(''); manageDocuments(dogId, 'manage').then(value => { if (live) { setIds(value); setLoaded(true) } }).catch(err => { if (live) setError(err.message) }); return () => { live = false } }, [dogId, refresh])
  async function save() {
    setBusy(true); setError(''); setSaved(false)
    try { setIds(await manageDocuments(dogId, 'save', ids.filter(id => eligible.some(doc => doc.id === id)))); setSaved(true) } catch (err) { setError(err instanceof Error ? err.message : 'Please retry') } finally { setBusy(false) }
  }
  const eligible = documents.filter(doc => /\.(pdf|jpe?g|png|webp)$/i.test(doc.filePath || doc.storagePath || doc.documentPath || ''))
  return <section style={{ background: '#f3f8f2', border: '1px solid #dae6da', padding: 16, borderRadius: 12, marginBottom: 20 }} aria-label="Share documents on QR profile">
    <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Documents shared on the QR profile</h3><p style={{ fontSize: 13, lineHeight: 1.6 }}>Choose which files anyone with this dog’s QR or link can view and download. Check for personal details before sharing. Other files stay private. After ownership transfer, the new owner chooses what to share.</p>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error} {!loaded && <button className="btn btn-secondary btn-sm" onClick={() => setRefresh(v => v + 1)}>Retry</button>}</p>}
    {loaded && <><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: '12px 0', display: 'grid', gap: 8 }}><legend style={{ fontSize: 13 }}>Select public documents</legend>{eligible.map(doc => <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, minHeight: 36 }}><input type="checkbox" checked={ids.includes(doc.id)} onChange={e => { setSaved(false); setIds(previous => e.target.checked ? [...previous, doc.id] : previous.filter(id => id !== doc.id)) }} />{doc.name || doc.title || 'Document'}</label>)}{!eligible.length && <p style={{ fontSize: 13 }}>Upload a PDF or image document to choose it here.</p>}</fieldset><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save QR document sharing'}</button>{saved && <p role="status" style={{ fontSize: 13 }}>QR document sharing saved.</p>}</>}
  </section>
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
