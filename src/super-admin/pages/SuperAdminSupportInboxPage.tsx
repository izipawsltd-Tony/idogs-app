import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

type Conversation = { id: string; ownerUid: string; ownerEmail?: string; ownerName?: string; organisationId?: string; organisationName?: string; subject: string; status: string; assigneeEmail?: string; lastMessagePreview?: string; lastMessageAt?: string; adminUnreadCount?: number }
type Message = { id: string; text: string; senderType: string; createdAt?: string }

const POLL_INTERVAL = 15000
const FILTERS = ['new', 'open', 'waiting_for_support', 'waiting_on_user', 'closed', 'all'] as const

function conversationTime(item: Conversation) {
  return Date.parse(item.lastMessageAt || '') || 0
}

function matchesSearch(item: Conversation, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  return [item.subject, item.ownerUid, item.ownerEmail, item.ownerName, item.organisationId, item.organisationName, item.lastMessagePreview]
    .filter(Boolean)
    .some(value => String(value).toLocaleLowerCase().includes(normalized))
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const merged = new Map(current.map(item => [item.id, item]))
  incoming.forEach(item => merged.set(item.id, item))
  return [...merged.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

export default function SuperAdminSupportInboxPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [list, setList] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const lock = useRef(false)
  const selectedRef = useRef<Conversation | null>(null)
  const inboxRequest = useRef(0)
  const threadRequest = useRef(0)
  const messageCount = useRef(0)
  const thread = useRef<HTMLDivElement>(null)
  const shouldScroll = useRef(true)

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(item => [item, item === 'all' ? list.length : list.filter(conversation => conversation.status === item).length])), [list])
  const unreadCount = useMemo(() => list.reduce((total, item) => total + Number(item.adminUnreadCount || 0), 0), [list])
  const visibleList = useMemo(() => list
    .filter(item => filter === 'all' || item.status === filter)
    .filter(item => matchesSearch(item, search))
    .sort((a, b) => conversationTime(b) - conversationTime(a)), [filter, list, search])

  async function call(path: string, init?: RequestInit) {
    const token = await user!.getIdToken()
    const response = await fetch(path, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    const raw = await response.text()
    let result: Record<string, any>
    try { result = JSON.parse(raw) } catch { throw new Error('Support returned an invalid response. Please try again.') }
    if (!response.ok) throw new Error(result.error || 'Request failed')
    return result
  }

  async function refreshInbox() {
    const request = ++inboxRequest.current
    setRefreshing(true)
    try {
      const result = await call('/api/super-admin/support-inbox?status=all')
      if (request !== inboxRequest.current) return
      const next = (result.conversations || []) as Conversation[]
      setList(next)
      setError('')
      const current = selectedRef.current
      if (current) {
        const fresh = next.find(item => item.id === current.id)
        if (fresh) {
          selectedRef.current = { ...current, ...fresh }
          setSelected(selectedRef.current)
        }
      }
    } catch {
      if (request === inboxRequest.current) setError('Inbox could not be loaded. Existing conversations are still shown where available.')
    } finally {
      if (request === inboxRequest.current) {
        setLoading(false)
        setRefreshing(false)
      }
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
      if (request !== threadRequest.current || selectedRef.current?.id !== id) return null
      const incoming = (result.messages || []) as Message[]
      const conversation = { ...selectedRef.current, ...(result.conversation || {}) } as Conversation
      selectedRef.current = conversation
      setSelected(conversation)
      setMessages(current => mergeMessages(current, incoming))
      setList(current => current.map(item => item.id === id ? { ...item, ...conversation, adminUnreadCount: 0 } : item))
      if (incoming.length > messageCount.current && !initial) setAnnouncement(`${incoming.length - messageCount.current} new support message${incoming.length - messageCount.current === 1 ? '' : 's'}`)
      messageCount.current = Math.max(messageCount.current, incoming.length)
      shouldScroll.current = keepAtBottom
      return incoming
    } catch {
      if (request === threadRequest.current) setError('Conversation could not be loaded.')
      return null
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
      if (lock.current) return
      await refreshInbox()
      if (selectedRef.current) await refreshThread(selectedRef.current.id)
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [user])

  async function act(action: string, payload: Record<string, unknown> = {}) {
    const current = selectedRef.current
    if (lock.current || !current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await call(`/api/super-admin/support-conversation?id=${encodeURIComponent(current.id)}`, { method: 'POST', body: JSON.stringify({ action, ...payload }) })
      const persisted = await refreshThread(current.id)
      if (action === 'reply') {
        if (typeof result.messageId !== 'string' || result.conversationId !== current.id || result.status !== 'waiting_on_user' || !result.updatedAt || !persisted?.some(item => item.id === result.messageId)) throw new Error('Support could not confirm the saved reply. Please refresh before retrying.')
        setMessage('')
      }
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
    <div className="super-admin-page-header"><div><span className="super-admin-kicker">Operations</span><h2>Support Inbox {unreadCount > 0 && <span className="support-admin-total-unread" aria-label={`${unreadCount} unread messages`}>{unreadCount}</span>}</h2><p>Persistent user conversations and in-app replies.</p></div><button className="support-admin-refresh" type="button" disabled={refreshing} onClick={refreshInbox}>{refreshing ? 'Refreshing…' : 'Refresh inbox'}</button></div>
    {error && <div className="support-admin-error" role="alert"><span>{error}</span><button type="button" onClick={refreshInbox}>Try again</button></div>}
    <p className="support-sr-live" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div className="support-admin-toolbar"><label className="support-admin-search" htmlFor="support-inbox-search"><span>Search conversations</span><input id="support-inbox-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Email, name, subject or message" /></label><div className="support-admin-filters" aria-label="Support status filters">{FILTERS.map(item => <button className={filter === item ? 'active' : ''} type="button" key={item} onClick={() => setFilter(item)} aria-pressed={filter === item}><span>{item.replaceAll('_', ' ')}</span><b>{counts[item]}</b></button>)}</div></div>
    <div className="support-admin-grid">
      <section className="super-admin-panel support-admin-list" aria-label="Support conversations">{loading ? <div className="support-admin-list-state" role="status">Loading conversations…</div> : visibleList.length === 0 ? <div className="support-admin-list-state"><strong>No conversations found</strong><span>{search ? 'Try a different search or status filter.' : 'There are no conversations in this status.'}</span></div> : visibleList.map(item => <button type="button" key={item.id} onClick={() => openConversation(item)} className={selected?.id === item.id ? 'selected' : ''} aria-pressed={selected?.id === item.id}><span className="support-admin-row-heading"><strong>{item.subject}</strong>{Number(item.adminUnreadCount) > 0 && <b aria-label={`${item.adminUnreadCount} unread`}>{item.adminUnreadCount}</b>}</span><span>{item.ownerEmail || item.ownerName || item.ownerUid}</span><small className="support-admin-preview">{item.lastMessagePreview || 'No preview'}</small><span className="support-admin-row-meta"><small>{item.status.replaceAll('_', ' ')}</small>{item.lastMessageAt && <time dateTime={item.lastMessageAt}>{new Date(item.lastMessageAt).toLocaleString()}</time>}</span></button>)}</section>
      <section className="super-admin-panel support-admin-thread">{selected ? <>
        <div className="support-admin-thread-heading"><div><span className={`support-admin-status status-${selected.status}`}>{selected.status.replaceAll('_', ' ')}</span><h3>{selected.subject}</h3></div><button className="support-admin-mobile-back" type="button" onClick={() => { selectedRef.current = null; setSelected(null) }}>Back to inbox</button></div>
        <p><Link to={`/app/super-admin/users/${selected.ownerUid}`}>{selected.ownerEmail || selected.ownerUid}</Link>{selected.organisationId && <> · <Link to={`/app/super-admin/organisations/${selected.organisationId}`}>{selected.organisationName || selected.organisationId}</Link></>}</p>
        <p>Assignee: <strong>{selected.assigneeEmail || 'Unassigned'}</strong></p>
        <div className="support-admin-actions"><button disabled={busy} onClick={() => act('assign')}>Assign to me</button><button disabled={busy} onClick={() => act('waiting_on_user')}>Waiting on user</button>{selected.status === 'closed' ? <button disabled={busy} onClick={() => reasonAction('reopen')}>Reopen</button> : <button disabled={busy} onClick={() => reasonAction('close')}>Close</button>}</div>
        <div className="support-admin-messages" ref={thread}>{messages.map(item => <div key={item.id} className={item.senderType}><p>{item.text}</p>{item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>}</div>)}</div>
        {selected.status === 'closed' ? <p>This conversation is closed. Reopen it before replying.</p> : <form onSubmit={reply}><label htmlFor="admin-support-reply">Reply</label><textarea id="admin-support-reply" maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} required/><button disabled={busy}>{busy ? 'Sending…' : 'Reply'}</button></form>}
      </> : <div className="support-admin-thread-empty"><strong>Select a conversation</strong><span>Choose a conversation from the inbox to view its history and reply.</span></div>}</section>
    </div>
  </div>
}
