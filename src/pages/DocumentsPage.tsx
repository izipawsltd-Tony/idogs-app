import { viewDocument } from '../lib/documentViewer'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRequestGuard } from '../hooks/useRequestGuard'
import { getAllDocumentsForUser, getDogs, deleteDocument } from '../lib/db'
import { uploadManualDocument } from '../lib/manualDocumentUpload'
import type { Dog, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const DOC_TYPES = [
  { value: 'vaccine_card',     label: 'Vaccine Card',           icon: '💉' },
  { value: 'health_test',      label: 'Health Test',            icon: '🔬' },
  { value: 'pedigree',         label: 'Pedigree Certificate',   icon: '📜' },
  { value: 'microchip_cert',   label: 'Microchip Certificate',  icon: '🔖' },
  { value: 'vet_record',       label: 'Vet Record',             icon: '🏥' },
  { value: 'contract',         label: 'Sale/Transfer Contract', icon: '📋' },
  { value: 'dna_test',         label: 'DNA Test',               icon: '🧬' },
  { value: 'other',            label: 'Other',                  icon: '📄' },
]

function getDocIcon(type: string) {
  return DOC_TYPES.find(d => d.value === type)?.icon || '📄'
}
function getDocLabel(type: string) {
  return DOC_TYPES.find(d => d.value === type)?.label || 'Document'
}


export default function DocumentsPage({ toast }: Props) {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<any[]>([])
  const [dogs, setDogs] = useState<Record<string, Dog>>({})
  const [loading, setLoading] = useState(true)
  // Codex round 14: distinct from `documents` being genuinely empty — a
  // failed load (getAllDocumentsForUser, which itself calls getDogs()
  // internally — see src/lib/db.ts) must never render as "No documents
  // yet" indefinitely.
  const [loadError, setLoadError] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [showUpload, setShowUpload] = useState(false)

  const { beginRequest } = useRequestGuard(user?.uid)

  function loadDocuments() {
    if (!user) return
    const req = beginRequest()
    setLoading(true)
    setLoadError(false)
    Promise.all([
      getAllDocumentsForUser(user.uid),
      getDogs(),
    ]).then(([docs, dogsData]) => {
      if (!req.isCurrent()) return
      const dogMap: Record<string, Dog> = {}
      dogsData.forEach((d: Dog) => { dogMap[d.id] = d })
      setDocuments(docs)
      setDogs(dogMap)
    }).catch(() => {
      if (!req.isCurrent()) return
      setLoadError(true)
      toast('Failed to load documents', 'error')
    }).finally(() => {
      if (!req.isCurrent()) return
      setLoading(false)
    })
  }

  useEffect(() => {
    // Clear the previous account's documents/dog map immediately on an
    // account switch — a stale document list from a former account must
    // never linger into the new one's view.
    setDocuments([]); setDogs({}); setLoadError(false); setFilter('all')
    loadDocuments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  function handleUpload(metadataSaved: boolean) {
    setShowUpload(false)
    loadDocuments()
    toast(metadataSaved ? 'Document uploaded' : 'Document uploaded; title/notes could not be saved. Refresh the list before retrying.', metadataSaved ? 'success' : 'error')
  }

  const FILTER_TABS = ['all', ...DOC_TYPES.map(d => d.value)]
  const filtered = documents.filter(d => filter === 'all' || d.documentType === filter)

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 2 }}>Documents</h1>
          {/* Codex round 15: a failed load must never show a document
              count — 0 or otherwise. It's not "0 documents", it's
              "unknown", and showing a number here at all implies the
              load succeeded. */}
          <p style={{ fontSize: 14, color: 'var(--light)' }}>
            {loadError ? 'Document count unavailable — load failed' : `${documents.length} document${documents.length !== 1 ? 's' : ''} saved`}
          </p>
        </div>
        <button onClick={() => setShowUpload(true)} className="btn btn-primary" disabled={loadError} title={loadError ? "Can't upload until your documents finish loading" : undefined}>
          + Upload Document
        </button>
      </div>

      {/* Filter tabs */}
      {!loadError && (
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {FILTER_TABS.map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: '7px 14px', borderRadius: 20, border: '1.5px solid',
              borderColor: filter === type ? 'var(--brand-600)' : 'var(--border)',
              background: filter === type ? 'var(--brand-50)' : 'var(--white)',
              color: filter === type ? 'var(--brand-600)' : 'var(--mid)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            {type === 'all' ? 'All' : getDocLabel(type)}
            {type !== 'all' && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
                ({documents.filter(d => d.documentType === type).length})
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      {loadError ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <div className="empty-state-title">Couldn't load your documents</div>
            <div className="empty-state-desc">This is a loading error, not an empty list. Please try again.</div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={loadDocuments}>Retry</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <div className="empty-state-title">No documents yet</div>
            <div className="empty-state-desc">
              {filter === 'all'
                ? 'Upload a document or use the iDogs Scan tab in a dog profile to scan and save records.'
                : `No ${getDocLabel(filter).toLowerCase()} documents yet.`}
            </div>
            {filter === 'all' && (
              <button onClick={() => setShowUpload(true)} className="btn btn-primary" style={{ marginTop: 8 }}>
                + Upload Document
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((doc, i) => {
            const dog = dogs[doc.dogId]
            const uploadDate = doc.uploadedAt?.toDate?.()?.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
            return (
              <div key={i} style={{
                background: 'var(--white)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: 'var(--brand-50)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.5rem', flexShrink: 0,
                }}>
                  {getDocIcon(doc.documentType)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)' }}>
                      {doc.name || doc.title || getDocLabel(doc.documentType)}
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--sand)', color: 'var(--mid)', fontWeight: 500 }}>
                      {(doc.fileType || 'FILE').toUpperCase()}
                    </span>
                    {doc.source === 'manual' && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--sand)', color: 'var(--mid)', fontWeight: 500 }}>Manual upload</span>
                    )}
                  </div>
                  {dog && (
                    <Link to={`/app/dogs/${doc.dogId}`} style={{ fontSize: 13, color: 'var(--brand-600)', textDecoration: 'none', fontWeight: 500 }}>
                      🐾 {dog.name}
                    </Link>
                  )}
                  {doc.notes && <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 2 }}>{doc.notes}</div>}
                  <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 2 }}>
                    {uploadDate || 'Recently uploaded'}
                  </div>
                  {doc.extractedData?.vaccines > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--brand-600)', marginTop: 2 }}>
                      💉 {doc.extractedData.vaccines} vaccine(s) extracted
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => viewDocument(user, toast, doc.filePath || doc.storagePath, doc.fileUrl)}
                    className="btn btn-secondary btn-sm"
                  >
                    View ↗
                  </button>
                  <button
                    onClick={async () => {
                      if (window.confirm('Remove this document from the list? (This will not delete the underlying health/vaccine record if one was created)')) {
                        try {
                          await deleteDocument(doc.id)
                          setDocuments(prev => prev.filter(d => d.id !== doc.id))
                          toast('Document removed')
                        } catch {
                          toast('Failed to remove document', 'error')
                        }
                      }
                    }}
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--error)' }}
                  >
                    🗑️ Remove from list
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <UploadModal
          dogs={Object.values(dogs)}
          userId={user!.uid}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUpload}
          toast={toast}
        />
      )}
    </div>
  )
}

// ── UPLOAD MODAL ─────────────────────────────────────────────

function UploadModal({ dogs, userId, onClose, onSuccess, toast }: {
  dogs: Dog[]
  userId: string
  onClose: () => void
  onSuccess: (metadataSaved: boolean) => void
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState('other')
  const [dogId, setDogId] = useState(dogs[0]?.id || '')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp,.heic'
  const MAX_MB = 3

  function handleFileChange(f: File) {
    if (f.size > MAX_MB * 1024 * 1024) {
      toast(`File too large — max ${MAX_MB}MB`, 'error')
      return
    }
    setFile(f)
    // Auto-set title from filename
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !dogId) return
    setUploading(true)
    try {
      if (!user || user.uid !== userId) throw new Error('Account changed; please reopen Upload')
      const result = await uploadManualDocument(user, file, dogId, docType, title || getDocLabel(docType), notes)
      onSuccess(result.metadataSaved)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed — please try again', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!uploading) onClose() }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Upload Document</h2>
          <button aria-label="Close upload" disabled={uploading} onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--light)', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Dog selector */}
          <div className="form-group">
            <label className="form-label">Dog *</label>
            <select className="form-select" value={dogId} onChange={e => setDogId(e.target.value)} required>
              {dogs.filter(d => (d as any).status !== 'transferred').map(d => (
                <option key={d.id} value={d.id}>{d.name} — {d.breed}</option>
              ))}
            </select>
          </div>

          {/* Document type */}
          <div className="form-group">
            <label className="form-label">Document type *</label>
            <select className="form-select" value={docType} onChange={e => setDocType(e.target.value)}>
              {DOC_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>

          {/* File drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f) }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--brand-600)' : file ? 'var(--brand-300)' : 'var(--border)'}`,
              borderRadius: 12, padding: '24px 16px', textAlign: 'center', cursor: 'pointer',
              background: dragOver ? 'var(--brand-50)' : file ? 'var(--brand-50)' : 'var(--sand)',
              transition: 'all 0.15s',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }}
            />
            {file ? (
              <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 2 }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>{(file.size / 1024).toFixed(0)} KB · Click to change</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 4 }}>Drop file here or click to browse</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>PDF, JPG, PNG, HEIC · Max {MAX_MB}MB</div>
              </>
            )}
          </div>

          {/* Title */}
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              placeholder={`e.g. ${getDocLabel(docType)} — ${new Date().getFullYear()}`}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="form-group">
            <label className="form-label">Notes (optional)</label>
            <input
              className="form-input"
              placeholder="e.g. OFA hip clearance, issued by Brisbane vet"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {uploading && <div role="status" style={{ fontSize: 12, color: 'var(--mid)' }}>Uploading secure document…</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={uploading}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!file || !dogId || uploading}>
              {uploading ? 'Uploading…' : 'Upload Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
