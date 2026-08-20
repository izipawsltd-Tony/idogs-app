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
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [faqItems, setFaqItems] = useState<Suggestion[]>([])
  type ChatTurn = { id: string; role: 'user' | 'assistant'; text: string }
  const [chatLog, setChatLog] = useState<ChatTurn[]>([])
  const [chatInput, setChatInput] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState('')
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState('')
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
    loadList(category)
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

  async function loadList(cat: string) {
    try {
      const result = await call('/api/support', { method: 'POST', body: JSON.stringify({ action: 'list', category: cat }) })
      setFaqItems(result.items || [])
    } catch { /* im lang, van con o go tay */ }
  }

  async function askAssistant(text: string) {
    const q = text.trim()
    if (!q || lock.current) return
    const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', text: q }
    setChatLog(prev => [...prev, userTurn])
    setChatInput('')
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await call('/api/support', { method: 'POST', body: JSON.stringify({ action: 'suggest', query: q, category }) })
      const hits = (result.suggestions || []) as Suggestion[]
      if (hits.length > 0) {
        setChatLog(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: hits[0].answer }])
      } else {
        // Khong co trong FAQ -> tao conversation cho support tra loi qua email/inbox
        const result2 = await call('/api/support', { method: 'POST', body: JSON.stringify({ action: 'handoff', subject: q.slice(0, 120), message: q }) })
        if (typeof result2.conversationId === 'string') {
          setChatLog(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: "Thanks for your question! I don't have a ready answer for this one, so I've passed it to our support team — they'll get back to you by email as soon as someone's available." }])
        } else {
          setChatLog(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: 'Sorry, something went wrong sending that. Please try again.' }])
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    } finally {
      setBusy(false)
      lock.current = false
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
        <div className="support-chat-flow">
          <div className="support-chat-log">
            <div className="support-message assistant"><p>Hi! I'm the iDogs assistant. Ask me anything — plans, QR Passport, scans, transfers — or pick a question below. If I can't answer, I'll pass it to our support team.</p></div>
            {faqItems.length > 0 && chatLog.length === 0 && (
              <div className="support-chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
                {faqItems.slice(0, 5).map(item => (
                  <button type="button" key={item.id} onClick={() => askAssistant(item.question)} style={{ padding: '6px 10px', background: 'var(--sand)', border: '1px solid var(--border)', borderRadius: 16, cursor: 'pointer', fontSize: 12, color: 'var(--dark)', textAlign: 'left' }}>{item.question}</button>
                ))}
              </div>
            )}
            {chatLog.map(turn => (
              <div key={turn.id} className={`support-message ${turn.role === 'user' ? 'user' : 'assistant'}`}><p>{turn.text}</p></div>
            ))}
          </div>
          <form className="support-composer" onSubmit={event => { event.preventDefault(); askAssistant(chatInput) }}>
            <label htmlFor="support-ask" className="support-sr-only">Ask a question</label>
            <select id="support-category" value={category} onChange={event => { setCategory(event.target.value); loadList(event.target.value) }} style={{ marginBottom: 6 }}>
              <option value="">All topics</option>
              {categories.map(item => <option key={item}>{item}</option>)}
            </select>
            <textarea id="support-ask" maxLength={500} value={chatInput} onChange={event => setChatInput(event.target.value)} placeholder="Type your question…" required />
            <button disabled={busy} type="submit">{busy ? 'Sending…' : 'Send'}</button>
          </form>
        </div>
      </>}
    </div>}
  </div>
}
