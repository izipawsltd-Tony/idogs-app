import { useState, useCallback } from 'react'
import type { ToastMessage } from '../types'

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const toast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Staging QA finding (Red Boy, item 4): a lingering toast from an
  // earlier action can still be on screen (within its 3.5s auto-dismiss
  // window) at the moment a user opens something new — e.g. an editor —
  // making it read as if THAT action produced the message, when it
  // didn't. Callers that open a fresh, deliberate UI session (an editor,
  // a modal) can use this to guarantee nothing stale is still showing.
  const dismissAll = useCallback(() => {
    setToasts([])
  }, [])

  return { toasts, toast, dismiss, dismissAll }
}
