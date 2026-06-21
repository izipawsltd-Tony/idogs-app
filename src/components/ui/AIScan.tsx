import { useState, useRef } from 'react'
import type { ToastMessage } from '../../types'

interface ScanResult {
  documentType: string
  dogName: string | null
  breed: string | null
  dateOfBirth: string | null
  microchip: string | null
  vaccines: Array<{
    name: string
    dateGiven: string | null
    nextDue: string | null
    vetClinic: string | null
    uncertain: boolean
  }>
  healthTest: {
    testType: string | null
    result: string | null
    dateTested: string | null
    lab: string | null
    certNumber: string | null
  } | null
  ankc: string | null
  notes: string | null
}

interface Props {
  onResult: (result: ScanResult, fileUrl?: string) => void
  toast: (msg: string, type?: ToastMessage['type']) => void
  dogId?: string
  tenantId?: string
}

// Resize image to max 1600px
async function resizeImage(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1600
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else { width = Math.round(width * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
    }
    img.onerror = reject
    img.src = url
  })
}

// Convert PDF to base64
async function readPDF(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'application/pdf' })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function AIScan({ onResult, toast, dogId, tenantId }: Props) {
  const [scanning, setScanning] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'image' | 'pdf' | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [currentFile, setCurrentFile] = useState<File | null>(null)

  async function handleFile(file: File) {
    if (!file) return
    setResult(null)
    setScanning(true)
    setCurrentFile(file)

    const isPDF = file.type === 'application/pdf'
    setPreviewType(isPDF ? 'pdf' : 'image')
    if (!isPDF) setPreview(URL.createObjectURL(file))
    else setPreview(null)

    try {
      const { base64, mediaType } = isPDF
        ? await readPDF(file)
        : await resizeImage(file)

      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Scan failed')
      }

      const data: ScanResult = await response.json()
      setResult(data)

      // Upload document FIRST, get fileUrl, THEN call onResult with fileUrl
      let fileUrl: string | undefined
      if (dogId && tenantId) {
        try {
          const uploadRes = await fetch('/api/upload-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64,
              mediaType,
              dogId,
              tenantId,
              documentType: data.documentType || 'other',
              extractedData: {
                dogName: data.dogName,
                vaccines: data.vaccines?.length || 0,
                healthTest: data.healthTest?.testType || null,
              },
            }),
          })
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json()
            fileUrl = uploadData.fileUrl
            toast('Document scanned & saved! ✓')
          } else {
            // FIX: previously this branch was silently skipped and the
            // generic success toast below still fired regardless, so a
            // failed document save (e.g. /api/upload-document erroring)
            // looked identical to a successful one — the only visible
            // symptom was the "View" button quietly missing later on the
            // Health tab, with no indication why.
            const errBody = await uploadRes.json().catch(() => ({}))
            console.error('Document upload failed:', uploadRes.status, errBody)
            toast('Scanned, but the document file could not be saved — record added without a viewable file', 'info')
          }
        } catch (uploadErr) {
          // FIX: this catch block previously swallowed the error
          // entirely with no logging, making it impossible to diagnose
          // why documentUrl ended up missing on saved records.
          console.error('Document upload error:', uploadErr)
          toast('Scanned, but the document file could not be saved — record added without a viewable file', 'info')
        }
      } else {
        toast('Document scanned!')
      }

      // Call onResult AFTER upload so fileUrl is available for saving to records
      onResult(data, fileUrl)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Scan failed', 'error')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div>
      {/* Upload area */}
      <div
        onClick={() => !scanning && fileRef.current?.click()}
        style={{
          border: '2px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 24px',
          textAlign: 'center',
          cursor: scanning ? 'default' : 'pointer',
          background: 'var(--sand)',
          transition: 'border-color .15s, background .15s',
          marginBottom: 16,
        }}
        onMouseEnter={e => { if (!scanning) { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.background = 'var(--green-light)' } }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--sand)' }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {scanning ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
            <div style={{ fontSize: 14, color: 'var(--green)', fontWeight: 500 }}>AI scanning document…</div>
            <div style={{ fontSize: 12, color: 'var(--light)' }}>Reading fields automatically</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 36 }}>📸</div>
            <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--dark)' }}>
              Photograph or upload a document
            </div>
            <div style={{ fontSize: 13, color: 'var(--light)' }}>
              Vaccine card · Pedigree cert · OFA certificate · Vet record
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 500 }}>📷 Photo</span>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--gold-light)', color: 'var(--gold)', fontWeight: 500 }}>📄 PDF</span>
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      {!scanning && previewType === 'image' && preview && (
        <div style={{ marginBottom: 16 }}>
          <img src={preview} alt="Preview" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }} />
        </div>
      )}
      {!scanning && previewType === 'pdf' && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--gold-light)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>📄</span>
          <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 500 }}>PDF uploaded — scanning…</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--green-light)', borderBottom: '1px solid rgba(8,80,65,.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
              {result.documentType === 'vaccine_card' ? 'Vaccine card detected' :
               result.documentType === 'pedigree' ? 'Pedigree certificate detected' :
               result.documentType === 'health_test' ? 'Health test result detected' :
               result.documentType === 'microchip_cert' ? 'Microchip certificate detected' :
               result.documentType === 'vet_record' ? 'Vet record detected' :
               'Document scanned'}
            </span>
          </div>
          <div style={{ padding: '8px 0' }}>
            {result.dogName && <ResultRow label="Dog name" value={result.dogName} />}
            {result.breed && <ResultRow label="Breed" value={result.breed} />}
            {result.dateOfBirth && <ResultRow label="Date of birth" value={result.dateOfBirth} />}
            {result.microchip && <ResultRow label="Microchip" value={result.microchip} />}
            {result.ankc && result.documentType === 'pedigree' && <ResultRow label="Dogs Australia Registration" value={result.ankc} />}
            {result.vaccines?.length > 0 && (
              <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--sand)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--light)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  Vaccines ({result.vaccines.length})
                </div>
                {result.vaccines.map((v, i) => (
                  <div key={i} style={{ fontSize: 13, marginBottom: 8, display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--green)', flexShrink: 0 }}>💉</span>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--dark)' }}>
                        {v.name}
                        {v.uncertain && <span style={{ fontSize: 11, color: 'var(--warning)', marginLeft: 6 }}>⚠ uncertain</span>}
                      </div>
                      {v.dateGiven && <div style={{ fontSize: 12, color: 'var(--light)' }}>Given: {v.dateGiven}</div>}
                      {v.nextDue && <div style={{ fontSize: 12, color: 'var(--light)' }}>Due: {v.nextDue}</div>}
                      {v.vetClinic && <div style={{ fontSize: 12, color: 'var(--light)' }}>{v.vetClinic}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {result.healthTest?.result && (
              <div style={{ padding: '8px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--light)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Health test</div>
                {result.healthTest.testType && <ResultRow label="Type" value={result.healthTest.testType.toUpperCase()} />}
                {result.healthTest.result && (() => {
                  const raw = result.healthTest.result as unknown
                  const safe = typeof raw === 'string' ? raw
                    : raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(', ')
                    : ''
                  const looksLikeAnkc = !!result.ankc && result.ankc.trim() !== '' && safe.includes(result.ankc.trim())
                  return looksLikeAnkc ? (
                    <div style={{ padding: '7px 16px', fontSize: 12, color: 'var(--warning)' }}>
                      ⚠ Result looked like the ANKC number — not saved as the test result, please check the document and enter the result manually
                    </div>
                  ) : (
                    <ResultRow label="Result" value={safe} />
                  )
                })()}
                {result.healthTest.dateTested && <ResultRow label="Date" value={result.healthTest.dateTested} />}
              </div>
            )}
          </div>
          <div style={{ padding: '10px 16px', background: 'var(--sand)', fontSize: 12, color: 'var(--light)' }}>
            Document saved to this dog's profile automatically.
          </div>
        </div>
      )}
    </div>
  )
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 16px', borderBottom: '1px solid var(--sand)', fontSize: 13 }}>
      <span style={{ color: 'var(--light)' }}>{label}</span>
      <span style={{ color: 'var(--green)', fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}
