import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

type Conversation = { id: string; ownerUid: string; ownerEmail?: string; ownerName?: string; organisationId?: string; organisationName?: string; subject: string; status: string; assigneeEmail?: string; lastMessagePreview?: string; lastMessageAt?: string; adminUnreadCount?: number }
type Message = { id: string; text: string; senderType: string; createdAt?: string }

const POLL_INTERVAL = 30000

function mergeMessages(current: Message[], incoming: Message[]) {
  const merged = new Map(current.map(item => [item.id, item]))
  incoming.forEach(item => merged.set(item.id, item))
  return [...merged.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

export default function SuperAdminSupportInboxPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState('all')
  const [list, setList] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const lock = useRef(false)
  const selectedRef = useRef<Conversation | null>(null)
  const inboxRequest = useRef(0)
  const threadRequest = useRef(0)
  const messageCount = useRef(0)
  const thread = useRef<HTMLDivElement>(null)
  const shouldScroll = useRef(true)

  async function call(path: string, init?: RequestInit) {
    const token = await user!.getIdToken()
    const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Request failed')
    return result
  }

  async function refreshInbox() {
    const request = ++inboxRequest.current
    try {
      const result = await call(`/api/super-admin/support-inbox?status=${filter}`)
      if (request !== inboxRequest.current) return
      const next = (result.conversations || []) as Conversation[]
      setList(next)
      const current = selectedRef.current
      if (current) {
        const fresh = next.find(item => item.id === current.id)
        if (fresh) {
          selectedRef.current = { ...current, ...fresh }
          setSelected(selectedRef.current)
        }
      }
    } catch {
      if (request === inboxRequest.current) setError('Inbox could not be loaded.')
    }
  }

  function nearBottom() {
    const element = thread.current
    return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }

  async function refreshThread(id: string, initial = false) {
    const request = ++threadRequest.current
    const keepAtBottom = initial || nearBottom()
    try {
      const result = await call(`/api/super-admin/support-conversation?id=${encodeURIComponent(id)}`)
      if (request !== threadRequest.current || selectedRef.current?.id !== id) return
      const incoming = (result.messages || []) as Message[]
      const conversation = { ...selectedRef.current, ...(result.conversation || {}) } as Conversation
      selectedRef.current = conversation
      setSelected(conversation)
      setMessages(current => mergeMessages(current, incoming))
      setList(current => current.map(item => item.id === id ? { ...item, ...conversation, adminUnreadCount: 0 } : item))
      if (incoming.length > messageCount.current && !initial) setAnnouncement(`${incoming.length - messageCount.current} new support message${incoming.length - messageCount.current === 1 ? '' : 's'}`)
      messageCount.current = Math.max(messageCount.current, incoming.length)
      shouldScroll.current = keepAtBottom
    } catch {
      if (request === threadRequest.current) setError('Conversation could not be loaded.')
    }
  }

  useEffect(() => {
    if (!shouldScroll.current || !thread.current) return
    thread.current.scrollTop = thread.current.scrollHeight
    shouldScroll.current = false
  }, [messages])

  async function openConversation(conversation: Conversation) {
    selectedRef.current = conversation
    setSelected(conversation)
    setMessages([])
    messageCount.current = 0
    setError('')
    await refreshThread(conversation.id, true)
    await refreshInbox()
  }

  useEffect(() => {
    if (!user) return
    refreshInbox()
    const timer = setInterval(async () => {
      await refreshInbox()
      if (selectedRef.current) await refreshThread(selectedRef.current.id)
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [filter, user])

  async function act(action: string, payload: Record<string, unknown> = {}) {
    const current = selectedRef.current
    if (lock.current || !current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await call(`/api/super-admin/support-conversation?id=${encodeURIComponent(current.id)}`, { method: 'POST', body: JSON.stringify({ action, ...payload }) })
      if (action === 'reply') setMessage('')
      await refreshThread(current.id)
      await refreshInbox()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function reply(event: FormEvent) {
    event.preventDefault()
    act('reply', { message })
  }

  function reasonAction(action: 'close' | 'reopen') {
    const reason = window.prompt(`${action === 'close' ? 'Close' : 'Reopen'} reason (minimum 5 characters)`, '')
    if (reason && reason.trim().length >= 5 && window.confirm(`Confirm ${action}?`)) act(action, { reason, confirmed: true })
  }

  return <div>
    <div className="super-admin-page-header"><div><span className="super-admin-kicker">Operations</span><h2>Support Inbox</h2><p>Persistent user conversations and in-app replies.</p></div></div>
    {error && <p role="alert">{error}</p>}
    <p className="support-sr-live" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div className="support-admin-filters" aria-label="Support status filters">{['new', 'open', 'waiting_on_user', 'closed', 'all'].map(item => <button className={filter === item ? 'active' : ''} type="button" key={item} onClick={() => setFilter(item)}>{item.replaceAll('_', ' ')}</button>)}</div>
    <div className="support-admin-grid">
      <section className="super-admin-panel support-admin-list" aria-label="Support conversations">{list.map(item => <button type="button" key={item.id} onClick={() => openConversation(item)} className={selected?.id === item.id ? 'selected' : ''} aria-pressed={selected?.id === item.id}><strong>{item.subject}</strong><span>{item.ownerEmail || item.ownerName || item.ownerUid}</span><small>{item.lastMessagePreview || 'No preview'} · {item.status.replaceAll('_', ' ')}</small>{Number(item.adminUnreadCount) > 0 && <b>{item.adminUnreadCount} unread</b>}</button>)}</section>
      <section className="super-admin-panel support-admin-thread">{selected ? <>
        <h3>{selected.subject}</h3>
        <p><Link to={`/app/super-admin/users/${selected.ownerUid}`}>{selected.ownerEmail || selected.ownerUid}</Link>{selected.organisationId && <> · <Link to={`/app/super-admin/organisations/${selected.organisationId}`}>{selected.organisationName || selected.organisationId}</Link></>}</p>
        <p>Status: {selected.status.replaceAll('_', ' ')} · Assignee: {selected.assigneeEmail || 'Unassigned'}</p>
        <div className="support-admin-actions"><button disabled={busy} onClick={() => act('assign')}>Assign to me</button><button disabled={busy} onClick={() => act('waiting_on_user')}>Waiting on user</button>{selected.status === 'closed' ? <button disabled={busy} onClick={() => reasonAction('reopen')}>Reopen</button> : <button disabled={busy} onClick={() => reasonAction('close')}>Close</button>}</div>
        <div className="support-admin-messages" ref={thread}>{messages.map(item => <div key={item.id} className={item.senderType}><p>{item.text}</p>{item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>}</div>)}</div>
        {selected.status === 'closed' ? <p>This conversation is closed. Reopen it before replying.</p> : <form onSubmit={reply}><label htmlFor="admin-support-reply">Reply</label><textarea id="admin-support-reply" maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} required/><button disabled={busy}>{busy ? 'Sending…' : 'Reply'}</button></form>}
      </> : <p>Select a conversation.</p>}</section>
    </div>
  </div>
}
