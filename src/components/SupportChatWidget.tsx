import { FormEvent, useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import './supportChat.css'

type Conversation = { id: string; subject: string; status: string; updatedAt?: string; userUnreadCount?: number }
type Suggestion = { id: string; question: string; answer: string; category: string }
type Message = { id: string; text: string; senderType: 'user' | 'admin'; createdAt?: string }

const POLL_INTERVAL = 30000

function mergeMessages(current: Message[], incoming: Message[]) {
  const merged = new Map(current.map(item => [item.id, item]))
  incoming.forEach(item => merged.set(item.id, item))
  return [...merged.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

export default function SupportChatWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState('')
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState('')
  const [handoff, setHandoff] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const lock = useRef(false)
  const activeRef = useRef('')
  const listRequest = useRef(0)
  const threadRequest = useRef(0)
  const messageCount = useRef(0)
  const shouldScroll = useRef(true)

  function rememberActive(id: string) {
    activeRef.current = id
    setActive(id)
    if (user) {
      try { sessionStorage.setItem(`idogs-support-active-${user.uid}`, id) } catch { /* Session storage is optional. */ }
    }
  }

  function storedActiveId() {
    if (!user) return null
    try { return sessionStorage.getItem(`idogs-support-active-${user.uid}`) } catch { return null }
  }

  async function call(path: string, init?: RequestInit) {
    if (!user) throw new Error('Sign in required')
    const token = await user.getIdToken()
    const response = await fetch(path, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } })
    const raw = await response.text()
    let result: Record<string, any>
    try { result = JSON.parse(raw) } catch { throw new Error('Support returned an invalid response. Please try again.') }
    if (!response.ok) throw new Error(result.error || 'Support request failed')
    return result
  }

  async function refreshConversation(id: string, initial = false) {
    const request = ++threadRequest.current
    const element = thread.current
    const keepAtBottom = initial || !element || element.scrollHeight - element.scrollTop - element.clientHeight < 80
    try {
      const result = await call(`/api/support/conversations/${encodeURIComponent(id)}`)
      if (request !== threadRequest.current || activeRef.current !== id) return null
      const incoming = (result.messages || []) as Message[]
      setMessages(current => mergeMessages(current, incoming))
      setActiveConversation(result.conversation || null)
      setConversations(current => current.map(item => item.id === id ? { ...item, ...(result.conversation || {}), userUnreadCount: 0 } : item))
      if (incoming.length > messageCount.current && !initial) setAnnouncement(`${incoming.length - messageCount.current} new support message${incoming.length - messageCount.current === 1 ? '' : 's'}`)
      messageCount.current = Math.max(messageCount.current, incoming.length)
      shouldScroll.current = keepAtBottom
      return incoming
    } catch {
      if (request === threadRequest.current && initial) setError('Conversation could not be loaded.')
      return null
    }
  }

  useEffect(() => {
    if (!shouldScroll.current || !thread.current) return
    thread.current.scrollTop = thread.current.scrollHeight
    shouldScroll.current = false
  }, [messages])

  async function selectConversation(id: string, initial = true) {
    rememberActive(id)
    setMessages([])
    messageCount.current = 0
    setError('')
    await refreshConversation(id, initial)
  }

  async function refreshList(chooseThread = false) {
    const request = ++listRequest.current
    try {
      const result = await call('/api/support')
      if (request !== listRequest.current) return
      const next = (result.conversations || []) as Conversation[]
      setConversations(next)
      setCategories(result.categories || [])
      const currentId = activeRef.current
      if (currentId) {
        const current = next.find(item => item.id === currentId)
        if (current) setActiveConversation(value => ({ ...(value || {}), ...current }))
      }
      if (chooseThread && !currentId) {
        const unread = next.find(item => Number(item.userUnreadCount || 0) > 0)
        const latestOpen = next.find(item => item.status !== 'closed')
        const stored = storedActiveId()
        const restored = stored ? next.find(item => item.id === stored && item.status !== 'closed') : undefined
        const selected = unread || restored || latestOpen
        if (selected) await selectConversation(selected.id)
      }
    } catch {
      if (request === listRequest.current && !activeRef.current) setError('Support could not be loaded.')
    }
  }

  useEffect(() => {
    if (!open || !user) return
    refreshList(!active)
    setTimeout(() => panel.current?.focus(), 0)
    const timer = setInterval(async () => {
      if (lock.current) return
      await refreshList(false)
      const activeId = active || activeRef.current
      if (activeId) await refreshConversation(activeId)
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [open, user, active])

  useEffect(() => {
    if (!user) {
      activeRef.current = ''
      setActive('')
      setActiveConversation(null)
      setMessages([])
      setConversations([])
    }
  }, [user])

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && open) setOpen(false)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  async function suggest(event: FormEvent) {
    event.preventDefault()
    if (lock.current || activeRef.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await call('/api/support', { method: 'POST', body: JSON.stringify({ action: 'suggest', query, category }) })
      setSuggestions(result.suggestions || [])
      setHandoff((result.suggestions || []).length === 0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function submitHandoff(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const sentText = message
      const result = await call('/api/support', { method: 'POST', body: JSON.stringify({ action: 'handoff', subject: query.slice(0, 120), message: sentText }) })
      if (typeof result.conversationId !== 'string' || typeof result.messageId !== 'string' || result.status !== 'new' || !result.updatedAt) throw new Error('Support could not confirm the saved conversation.')
      rememberActive(result.conversationId)
      setMessages([])
      const persisted = await refreshConversation(result.conversationId, true)
      if (!persisted?.some(item => item.id === result.messageId)) throw new Error('Support could not confirm the saved message. Please refresh before retrying.')
      setMessage('')
      setHandoff(false)
      setSuggestions([])
      await refreshList(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function reply(event: FormEvent) {
    event.preventDefault()
    const id = activeRef.current
    if (lock.current || !id || activeConversation?.status === 'closed') return
    lock.current = true
    setBusy(true)
    setError('')
    const sentText = message
    try {
      const result = await call(`/api/support/conversations/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ message: sentText }) })
      if (typeof result.messageId !== 'string' || result.conversationId !== id || result.status !== 'waiting_for_support' || !result.updatedAt) throw new Error('Support could not confirm the saved message.')
      const persisted = await refreshConversation(id)
      if (!persisted?.some(item => item.id === result.messageId)) throw new Error('Support could not confirm the saved message. Please refresh before retrying.')
      setMessage('')
      await refreshList(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function backToConversations() {
    activeRef.current = ''
    setActive('')
    setActiveConversation(null)
    setMessages([])
    setAnnouncement('')
    if (user) {
      try { sessionStorage.removeItem(`idogs-support-active-${user.uid}`) } catch { /* Session storage is optional. */ }
    }
  }

  const unread = conversations.reduce((total, item) => total + Number(item.userUnreadCount || 0), 0)
  const closed = activeConversation?.status === 'closed'

  return <div className="support-chat-root">
    <button className="support-chat-launcher" type="button" aria-expanded={open} aria-controls="support-chat-panel" onClick={() => setOpen(value => !value)}>Support{unread > 0 && <span aria-label={`${unread} unread replies`}>{unread}</span>}</button>
    {open && <div id="support-chat-panel" className="support-chat-panel" role="dialog" aria-modal="false" aria-label="iDogs Support" tabIndex={-1} ref={panel}>
      <header><div><strong>iDogs Support</strong><small>We usually reply within 1 business day.</small></div><button type="button" aria-label="Close support" onClick={() => setOpen(false)}>×</button></header>
      <p className="support-privacy">Do not share passwords, card details or sensitive medical information.</p>
      {error && <p role="alert" className="support-error">{error}</p>}
      <p className="support-sr-live" aria-live="polite" aria-atomic="true">{announcement}</p>
      {active ? <div className="support-thread-view">
        {conversations.length > 1 && <button type="button" className="support-back" onClick={backToConversations}>← Back to conversations</button>}
        <div className="support-thread-heading"><strong>{activeConversation?.subject || 'Support conversation'}</strong><span>{(activeConversation?.status || '').replaceAll('_', ' ')}</span></div>
        <div className="support-messages" ref={thread}>{messages.map(item => <div key={item.id} className={`support-message ${item.senderType}`}><p>{item.text}</p>{item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>}</div>)}</div>
        {closed ? <div className="support-closed"><p>This conversation is closed and remains available to read.</p><button type="button" onClick={backToConversations}>Start a new conversation</button></div> : <form className="support-composer" onSubmit={reply}><label htmlFor="support-reply">Reply</label><textarea id="support-reply" maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} required/><button disabled={busy} type="submit">{busy ? 'Sending…' : 'Send'}</button></form>}
      </div> : <>
        {conversations.length > 0 && <section><h3>Your conversations</h3>{conversations.map(item => <button type="button" className="support-conversation" key={item.id} onClick={() => selectConversation(item.id)}><span>{item.subject}</span><small>{item.status.replaceAll('_', ' ')}{Number(item.userUnreadCount || 0) > 0 ? ` · ${item.userUnreadCount} unread` : ''}</small></button>)}</section>}
        <form onSubmit={suggest}><label htmlFor="support-category">FAQ category</label><select id="support-category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select><label htmlFor="support-question">How can we help?</label><textarea id="support-question" maxLength={500} value={query} onChange={event => setQuery(event.target.value)} required/><button disabled={busy} type="submit">Find answers</button></form>
        {suggestions.map(item => <article className="support-faq" key={item.id}><strong>{item.question}</strong><p>{item.answer}</p><div><button type="button" onClick={() => call('/api/support', { method: 'POST', body: JSON.stringify({ action: 'feedback', faqId: item.id, helpful: true }) }).then(() => setSuggestions([]))}>This answered my question</button><button type="button" onClick={() => setHandoff(true)}>Talk to support</button></div></article>)}
        {(handoff || suggestions.length === 0 && query) && <form onSubmit={submitHandoff}><h3>Talk to support</h3><label htmlFor="support-message">Message</label><textarea id="support-message" maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} required/><button disabled={busy} type="submit">{busy ? 'Starting…' : 'Start conversation'}</button></form>}
      </>}
    </div>}
  </div>
}
