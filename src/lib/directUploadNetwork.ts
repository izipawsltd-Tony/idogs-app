// Only transport failures are translated here. HTTP/provider validation errors
// retain their existing handling. Never attach raw exceptions: signed URLs and
// authorization details can occur in browser/network error messages.
export type UploadStage = 'request' | 'storage' | 'confirmation'
const messages: Record<UploadStage, string> = {
  request: 'Could not start the upload. Check your connection and try again.',
  storage: 'Could not send the file to storage. Check your connection and try again.',
  confirmation: 'The file was sent, but its upload could not be confirmed. Refresh the gallery before trying again.',
}
export async function withUploadNetworkError<T>(stage: UploadStage, request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch {
    throw new Error(messages[stage])
  }
}
