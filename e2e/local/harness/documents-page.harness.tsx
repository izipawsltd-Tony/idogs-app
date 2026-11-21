// DOC-MOBILE-01 harness: renders the REAL DocumentsPage component with the
// REAL app stylesheets inside the same mobile shell AppLayout uses
// (.main-area > main > page, fixed .bottom-nav). Only Firebase-backed modules
// (db, useAuth, firebase) are swapped for synthetic stubs at bundle time —
// see documents-mobile-layout.spec.ts. No network, no real data.
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import DocumentsPage from '../../../src/pages/DocumentsPage'

const toasts: string[] = []
;(window as any).__harness.toasts = toasts

createRoot(document.querySelector('main')!).render(
  <MemoryRouter initialEntries={['/app/documents']}>
    <DocumentsPage toast={msg => { toasts.push(msg) }} />
    <div className="support-chat-root"><button className="support-chat-launcher" type="button">Support</button></div>
  </MemoryRouter>,
)
