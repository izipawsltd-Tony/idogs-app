export function documentExtension(mediaType?: string): string

export interface DocumentMetadataInput {
  uid: string
  dogId: string
  documentType?: string
  title?: unknown
  notes?: unknown
  source?: string
  extractedData?: unknown
  fileName: string
  filePath: string
  mediaType?: string
  uploadedAt: Date
}

export function documentMetadata(input: DocumentMetadataInput): Record<string, unknown>
