import { useEffect, useRef, useState, type TouchEvent } from 'react'

export interface StoryMedia { key: string; id: string; url: string; kind: 'photo' | 'video'; caption: string }

export default function PuppyMediaViewer({ items, initialKey, close }: { items: StoryMedia[]; initialKey: string; close: () => void }) {
  const [active, setActive] = useState(initialKey)
  const dialog = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const index = Math.max(0, items.findIndex(item => item.key === active))
  const current = items[index]
  function move(direction: number) { if (items.length > 1) setActive(items[(index + direction + items.length) % items.length].key) }
  const actions = useRef({ move, close })
  actions.current = { move, close }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.querySelectorAll('video').forEach(video => { if (!dialog.current?.contains(video)) video.pause() })
    closeButton.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') actions.current.close()
      if ((event.target as HTMLElement)?.tagName !== 'VIDEO') {
        if (event.key === 'ArrowLeft') { event.preventDefault(); actions.current.move(-1) }
        if (event.key === 'ArrowRight') { event.preventDefault(); actions.current.move(1) }
      }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), video[controls]') || [])]
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  function start(event: TouchEvent<HTMLDivElement>) {
    const point = event.touches.length === 1 ? event.touches[0] : null
    const target = event.target as HTMLElement
    // Keep native video seeking/volume controls usable.
    const onControls = point && target.tagName === 'VIDEO' && point.clientY > target.getBoundingClientRect().bottom - 48
    touch.current = point && !onControls ? { x: point.clientX, y: point.clientY } : null
  }
  function end(event: TouchEvent<HTMLDivElement>) {
    const origin = touch.current
    touch.current = null
    if (!origin || event.changedTouches.length !== 1) return
    const dx = event.changedTouches[0].clientX - origin.x, dy = event.changedTouches[0].clientY - origin.y
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) move(dx < 0 ? 1 : -1)
  }
  if (!current) return null
  return <div ref={dialog} role="dialog" aria-modal="true" aria-label="Photos and videos" style={{ position: 'fixed', inset: 0, zIndex: 1500, background: '#101413', color: '#fff', display: 'flex', flexDirection: 'column', padding: 'max(12px, env(safe-area-inset-top)) 12px max(16px, env(safe-area-inset-bottom))', overscrollBehavior: 'contain' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><span role="status" aria-live="polite">{index + 1} / {items.length}</span><button ref={closeButton} type="button" className="btn btn-secondary" onClick={close}>Close gallery</button></header>
    <div onTouchStart={start} onTouchEnd={end} onTouchCancel={() => { touch.current = null }} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', touchAction: 'pan-y pinch-zoom', padding: '12px 0' }}>
      {current.kind === 'photo' ? <img key={current.key} src={current.url} alt={current.caption || 'Puppy memory'} draggable={false} style={{ maxWidth: '100%', maxHeight: '65dvh', objectFit: 'contain' }} /> : <video key={current.key} src={current.url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: '65dvh', background: '#000' }} />}
    </div>
    {current.caption && <p style={{ margin: '4px 0 12px', textAlign: 'center', maxHeight: '12dvh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{current.caption}</p>}
    <nav aria-label="Gallery navigation" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><button type="button" className="btn btn-secondary" disabled={items.length < 2} onClick={() => move(-1)} aria-label="Previous photo or video">← Previous</button><span style={{ fontSize: 12, textAlign: 'center' }}>Swipe to browse</span><button type="button" className="btn btn-secondary" disabled={items.length < 2} onClick={() => move(1)} aria-label="Next photo or video">Next →</button></nav>
  </div>
}
