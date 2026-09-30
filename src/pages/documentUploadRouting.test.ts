import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const documentsPage = readFileSync(new URL('./DocumentsPage.tsx', import.meta.url), 'utf8')
const dogDetailPage = readFileSync(new URL('./DogDetailPage.tsx', import.meta.url), 'utf8')
const dogNewPage = readFileSync(new URL('./DogNewPage.tsx', import.meta.url), 'utf8')
const aiScan = readFileSync(new URL('../components/ui/AIScan.tsx', import.meta.url), 'utf8')
const uploadApi = readFileSync(new URL('../../api/upload-document.js', import.meta.url), 'utf8')

describe('document upload routing regressions', () => {
  it('routes manual uploads through the authenticated private server endpoint', () => {
    expect(documentsPage).toContain("fetch('/api/upload-document'")
    expect(documentsPage).toContain('Authorization: `Bearer ${idToken}`')
    expect(documentsPage).not.toContain('uploadBytesResumable')
    expect(documentsPage).not.toContain('getDownloadURL')
  })

  it('returns and inserts the exact scan-created document without duplicate refresh reads', () => {
    expect(uploadApi).toContain('document: { ...documentData, id: documentRef.id')
    expect(aiScan).toContain('uploadedDocument = uploadData.document')
    expect(dogDetailPage).toContain('setDocuments(prev => prev.some')
    const scanHandler = dogDetailPage.slice(
      dogDetailPage.indexOf('async function handleScanResult'),
      dogDetailPage.indexOf('async function handleTransfer'),
    )
    expect(scanHandler).not.toContain('getDogDocuments(dogId)')
  })

  it('keeps deferred new-dog scan uploads authenticated', () => {
    expect(dogNewPage).toContain('Authorization: `Bearer ${await user.getIdToken()}`')
  })

  it('validates supported private document types and the 10MB server limit', () => {
    for (const mediaType of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      expect(uploadApi).toContain(mediaType)
    }
    expect(uploadApi).toContain('MAX_FILE_BYTES = 10 * 1024 * 1024')
    expect(uploadApi).toContain("return res.status(413)")
    expect(uploadApi).not.toContain('await file.makePublic')
  })
})
