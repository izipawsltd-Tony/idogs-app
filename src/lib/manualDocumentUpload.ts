import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { getDogDocuments } from './db'

// Leave room for base64 expansion within the existing serverless JSON body limit.
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }

export async function uploadManualDocument(
  user: { uid: string; getIdToken: () => Promise<string> },
  file: File, dogId: string, documentType: string, title: string, notes: string,
): Promise<{ metadataSaved: boolean }> {
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new Error('File must be between 1 byte and 3 MB')
  const mediaType = TYPES[file.name.split('.').pop()?.toLowerCase() || '']
  if (!mediaType) throw new Error('Unsupported document format')
  if (!dogId || auth.currentUser?.uid !== user.uid) throw new Error('Account changed; please reopen Upload')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
  const token = await user.getIdToken()
  if (auth.currentUser?.uid !== user.uid) throw new Error('Account changed; please reopen Upload')
  const response = await fetch('/api/upload-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ base64, mediaType, dogId, documentType }),
  })
  if (!response.ok) throw new Error(response.status === 413 ? 'File too large for upload' : 'Upload failed — please try again')
  // The API already creates the private document record. Never add a second one.
  // Once upload succeeds, a metadata/read failure must not invite duplicate uploads.
  try {
    const { success, filePath } = await response.json()
    if (!success || typeof filePath !== 'string') return { metadataSaved: false }
    if (auth.currentUser?.uid !== user.uid) return { metadataSaved: false }
    const records = await getDogDocuments(dogId)
    const record = records.find(d => d.filePath === filePath)
    if (!record || auth.currentUser?.uid !== user.uid) return { metadataSaved: false }
    await updateDoc(doc(db, 'documents', record.id), {
      name: title.trim() || file.name, title: title.trim() || file.name,
      notes: notes.trim() || null, source: 'manual',
    })
    return { metadataSaved: true }
  } catch { return { metadataSaved: false } }
}
