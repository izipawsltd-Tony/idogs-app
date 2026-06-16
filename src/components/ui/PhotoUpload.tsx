import { useState, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type { ToastMessage } from '../../types'

interface Props {
  dogId: string
  currentPhoto?: string
  onUpload: (url: string) => void
  toast: (msg: string, type?: ToastMessage['type']) => void
}

async function resizeImage(file: File, maxPx = 800): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
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
    img.onerror = reject
    img.src = url
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
      const { base64, mediaType } = await resizeImage(file)

      const res = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mediaType, dogId, userId: user.uid }),
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
