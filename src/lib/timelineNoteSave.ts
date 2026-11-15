export class TimelinePhotoError extends Error {
  constructor() { super('Photo upload failed. Your note and selected photo are still here. Please retry.') }
}

// Do not commit a text-only note when the user explicitly attached a photo.
export async function saveNoteWithPhoto(
  uploadPhoto: (() => Promise<Response>) | null,
  saveNote: (photoUrl?: string) => Promise<unknown>,
) {
  let photoUrl: string | undefined
  if (uploadPhoto) {
    try {
      const response = await uploadPhoto()
      if (!response.ok) throw new TimelinePhotoError()
      const data = await response.json()
      const url = new URL(data.fileUrl)
      if (url.protocol !== 'https:') throw new TimelinePhotoError()
      photoUrl = url.href
    } catch { throw new TimelinePhotoError() }
  }
  await saveNote(photoUrl)
}
