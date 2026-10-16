import { isNativeApp } from './nativePlatform'
import type { ToastMessage } from '../types'

function secureUrl(value: unknown): string {
  if (typeof value !== 'string' || new URL(value).protocol !== 'https:') throw new Error('Invalid document URL')
  return value
}

export async function viewDocument(
  user: { getIdToken: () => Promise<string> } | null | undefined,
  toast: (msg: string, type?: ToastMessage['type']) => void,
  path?: string | null,
  legacyUrl?: string | null,
) {
  if (!path) {
    try { if (legacyUrl) window.open(secureUrl(legacyUrl), '_blank', 'noopener,noreferrer') }
    catch { toast('Could not open document', 'error') }
    return
  }
  if (!user) { toast('Please sign in to view this document', 'error'); return }
  // Browsers need a synchronous popup. Native must open the final URL:
  // Android sends window.open to the external browser immediately.
  const newWin = isNativeApp() ? null : window.open('about:blank', '_blank')
  if (newWin) newWin.opener = null
  try {
    const idToken = await user.getIdToken()
    const response = await fetch('/api/get-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ filePath: path }),
    })
    if (!response.ok) {
      newWin?.close()
      toast(response.status === 404 ? 'This file is missing from storage. You can remove this broken document record.' : 'Could not open document. Please try again.', 'error')
      return
    }
    const url = secureUrl((await response.json()).url)
    if (newWin) newWin.location.href = url
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    newWin?.close()
    toast('Could not open document. Please check connection.', 'error')
  }
}
