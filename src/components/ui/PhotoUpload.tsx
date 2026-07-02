import { useState, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type { ToastMessage } from '../../types'

interface Props {
  dogId: string
  currentPhoto?: string
  onUpload: (url: string) => void
  toast: (msg: string, type?: ToastMessage['type']) => void
}

// FIX: iPhone photos saved as .heic/.heif can't be decoded by <img> in
// Chrome/Firefox/Edge (only Safari supports it natively) — img.onload
// never fires for these, so the upload silently hung forever with no
// error and no spinner timeout. Detect HEIC up front and fail fast with
// a clear, actionable message instead.
function isHeic(file: File): boolean {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')
}

async function resizeImage(file: File | Blob, maxPx = 800): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    // Safety net: if neither onload nor onerror fires within 10s (seen
    // happen with some unsupported formats even beyond HEIC), fail
    // instead of leaving the spinner stuck forever with no feedback.
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new Error('Image could not be read — it may be an unsupported format'))
    }, 10000)
    img.onload = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round(height * maxPx / width); width = maxPx }
        else { width = Math.round(width * maxPx / height); height = maxPx }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
    }
    img.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      reject(new Error('Image could not be read'))
    }
    img.src = url
  })
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function PhotoUpload({ dogId, currentPhoto, onUpload, toast }: Props) {
  const { user } = useAuth()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file || !user) return

    setUploading(true)
    try {
      let base64: string
      let mediaType: string

      if (isHeic(file)) {
        // Send raw HEIC to server \u2014 sharp handles conversion server-side
        base64 = await readAsBase64(file)
        mediaType = file.type || 'image/heic'
      } else {
        const resized = await resizeImage(file)
        base64 = resized.base64
        mediaType = resized.mediaType
      }

      const idToken = await user.getIdToken()
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ base64, mediaType, dogId }),
      })

      if (!res.ok) throw new Error('Upload failed')

      const { fileUrl } = await res.json()
      onUpload(fileUrl)
      toast('Photo updated! ✓')
    } catch {
      toast('Upload failed — please try again', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={() => !uploading && fileRef.current?.click()}
        style={{
          width: 72, height: 72, borderRadius: '50%',
          background: currentPhoto ? `url(${currentPhoto}) center/cover` : 'var(--green-light)',
          border: '2px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: uploading ? 'default' : 'pointer',
          fontSize: 28, position: 'relative', overflow: 'hidden',
        }}
      >
        {!currentPhoto && '🐕'}
        {uploading && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div className="spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 22, height: 22, borderRadius: '50%',
          background: uploading ? 'var(--light)' : 'var(--green)',
          border: '2px solid white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: uploading ? 'default' : 'pointer', fontSize: 11,
        }}
        onClick={() => !uploading && fileRef.current?.click()}
      >📷</div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  )
}
