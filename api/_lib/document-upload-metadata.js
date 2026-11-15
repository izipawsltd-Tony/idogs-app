const EXTENSION_BY_MEDIA_TYPE = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export function documentExtension(mediaType) {
  return EXTENSION_BY_MEDIA_TYPE[mediaType] || 'bin'
}

export function documentMetadata({ uid, dogId, documentType, title, notes, source, extractedData, fileName, filePath, mediaType, uploadedAt }) {
  const ext = documentExtension(mediaType)
  return {
    dogId,
    tenantId: uid,
    fileName,
    fileUrl: null,
    filePath,
    fileType: source === 'manual' ? ext : (ext === 'pdf' ? 'pdf' : 'image'),
    documentType: documentType || 'other',
    ...(typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 200) } : {}),
    ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim().slice(0, 1000) } : {}),
    source: source === 'manual' ? 'manual' : 'scan',
    uploadedAt,
    extractedData: extractedData && typeof extractedData === 'object' ? extractedData : {},
  }
}
