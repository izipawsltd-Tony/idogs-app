import type { ToastMessage } from '../../types'

interface Props {
  toasts: ToastMessage[]
  dismiss: (id: string) => void
}

export default function ToastContainer({ toasts, dismiss }: Props) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => dismiss(t.id)}
          role="alert"
        >
          {t.type === 'success' && <span>✓</span>}
          {t.type === 'error' && <span>✕</span>}
          {t.type === 'info' && <span>ℹ</span>}
          {t.message}
        </div>
      ))}
    </div>
  )
}
