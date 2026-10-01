import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const documentsPage = readFileSync(fileURLToPath(new URL('./DocumentsPage.tsx', import.meta.url)), 'utf8')
const dogNewPage = readFileSync(fileURLToPath(new URL('./DogNewPage.tsx', import.meta.url)), 'utf8')
const dogDetailPage = readFileSync(fileURLToPath(new URL('./DogDetailPage.tsx', import.meta.url)), 'utf8')
const aiScan = readFileSync(fileURLToPath(new URL('../components/ui/AIScan.tsx', import.meta.url)), 'utf8')
const uploadApi = readFileSync(fileURLToPath(new URL('../../api/upload-document.js', import.meta.url)), 'utf8')

describe('document upload flow regression', () => {
  it('routes manual document uploads through the authenticated server endpoint', () => {
    expect(documentsPage).toContain("fetch('/api/upload-document'")
    expect(documentsPage).toContain('Authorization: `Bearer ${idToken}`')
    expect(documentsPage).not.toContain('uploadBytesResumable')
    expect(documentsPage).not.toContain("from 'firebase/storage'")
  })

  it('keeps pre-create scans and uploads them with auth after the dog exists', () => {
    expect(aiScan).toContain('rawFile?: { base64: string; mediaType: string; documentType: string }')
    expect(aiScan).toContain('dogId ? undefined : { base64, mediaType')
    expect(dogNewPage).toContain('const idToken = await user.getIdToken()')
    expect(dogNewPage).toContain('Authorization: `Bearer ${idToken}`')
  })

  it('refreshes the dog Documents tab once, immediately after a persisted scan', () => {
    expect(dogDetailPage.match(/if \(filePath\) retryDocuments\(\)/g)).toHaveLength(1)
    expect(dogDetailPage).not.toContain('getDogDocuments(dogId).catch(() => documents)')
  })
})

describe('upload-document API metadata', () => {
  it('returns the created document id and keeps uploads private', () => {
    expect(uploadApi).toContain('documentId: docRef.id')
    expect(uploadApi).toContain('documentMetadata({')
    expect(uploadApi).not.toContain('await file.makePublic()')
  })
})
