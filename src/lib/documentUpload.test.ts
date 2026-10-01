import { describe, expect, it } from 'vitest'
import { documentExtension, documentMetadata } from '../../api/_lib/document-upload-metadata.js'

describe('private document upload metadata', () => {
  it('preserves manual document type, title, notes, source, and private path', () => {
    const uploadedAt = new Date('2026-10-01T00:00:00.000Z')
    const metadata = documentMetadata({
      uid: 'owner-1', dogId: 'dog-1', documentType: 'pedigree',
      title: '  Pedigree Certificate  ', notes: '  Original copy  ', source: 'manual',
      extractedData: {}, fileName: 'pedigree_1.pdf',
      filePath: 'documents/owner-1/dog-1/pedigree_1.pdf', mediaType: 'application/pdf', uploadedAt,
    })

    expect(metadata).toMatchObject({
      tenantId: 'owner-1', dogId: 'dog-1', documentType: 'pedigree',
      title: 'Pedigree Certificate', notes: 'Original copy', source: 'manual',
      fileType: 'pdf', fileUrl: null,
      filePath: 'documents/owner-1/dog-1/pedigree_1.pdf', uploadedAt,
    })
  })

  it('keeps scanned pedigree metadata and derives extensions from MIME type, not a client filename', () => {
    expect(documentExtension('image/png')).toBe('png')
    expect(documentExtension('application/pdf')).toBe('pdf')
    expect(documentExtension('text/html')).toBe('bin')

    expect(documentMetadata({
      uid: 'owner-1', dogId: 'dog-1', documentType: 'pedigree', source: 'scan',
      extractedData: { dogName: 'Scout' }, fileName: 'pedigree_1.png',
      filePath: 'documents/owner-1/dog-1/pedigree_1.png', mediaType: 'image/png', uploadedAt: new Date(),
    })).toMatchObject({ documentType: 'pedigree', source: 'scan', fileType: 'image', extractedData: { dogName: 'Scout' } })
  })
})
