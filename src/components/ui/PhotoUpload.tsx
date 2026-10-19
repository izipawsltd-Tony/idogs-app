import { useState, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { prepareImageForUpload } from '../../lib/imageCompression'
import type { ToastMessage } from '../../types'

interface Props {
  dogId: string
  currentPhoto?: string
  onUpload: (url: string) => void
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function PhotoUpload({ dogId, currentPhoto, onUpload, toast }: Props) {
  const { user } = useAuth()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file || !user) return

    setUploading(true)
    try {
      const { base64, mediaType } = await prepareImageForUpload(file)

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
