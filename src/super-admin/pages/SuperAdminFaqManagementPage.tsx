import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

type Faq = { id: string; question: string; answer: string; category: string; keywords: string[]; sortOrder: number; status: string }
type FaqForm = { question: string; answer: string; category: string; keywords: string; sortOrder: number }
const EMPTY_FORM: FaqForm = { question: '', answer: '', category: '', keywords: '', sortOrder: 0 }

export default function SuperAdminFaqManagementPage() {
  const { user } = useAuth()
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [form, setForm] = useState<FaqForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  const visibleFaqs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return faqs.filter(faq => (status === 'all' || faq.status === status) && (!query || [faq.question, faq.answer, faq.category, ...(faq.keywords || [])].some(value => String(value).toLocaleLowerCase().includes(query))))
  }, [faqs, search, status])
  const counts = useMemo(() => ({ all: faqs.length, draft: faqs.filter(faq => faq.status === 'draft').length, published: faqs.filter(faq => faq.status === 'published').length }), [faqs])

  async function call(init?: RequestInit) {
    const token = await user!.getIdToken()
    const response = await fetch('/api/super-admin/support-faqs', { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    const raw = await response.text()
    let result: Record<string, any>
    try { result = JSON.parse(raw) } catch { throw new Error('FAQ service returned an invalid response.') }
    if (!response.ok) throw new Error(result.error || 'Request failed')
    return result
  }

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const result = await call()
      setFaqs(result.faqs || [])
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'FAQs could not be loaded.')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [user])

  function resetForm() {
    setEditingId('')
    setForm(EMPTY_FORM)
    setPreview(false)
  }

  function edit(faq: Faq) {
    setEditingId(faq.id)
    setForm({ question: faq.question, answer: faq.answer, category: faq.category, keywords: (faq.keywords || []).join(', '), sortOrder: faq.sortOrder || 0 })
    setPreview(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await call({ method: 'POST', body: JSON.stringify({ id: editingId || undefined, action: 'save', question: form.question, answer: form.answer, category: form.category, keywords: form.keywords.split(',').map(value => value.trim()).filter(Boolean), sortOrder: Number(form.sortOrder) }) })
      resetForm()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'FAQ could not be saved.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function publish(faq: Faq, action: 'publish' | 'unpublish') {
    if (lock.current || !window.confirm(`Confirm ${action} FAQ?`)) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await call({ method: 'POST', body: JSON.stringify({ id: faq.id, action, confirmed: true }) })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `FAQ could not be ${action === 'publish' ? 'published' : 'unpublished'}.`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <div>
    <div className="super-admin-page-header"><div><span className="super-admin-kicker">Operations</span><h2>FAQ Management</h2><p>Draft, preview and publish deterministic support answers.</p></div><button className="support-faq-refresh" type="button" onClick={load} disabled={loading || busy}>{loading ? 'Refreshing…' : 'Refresh FAQs'}</button></div>
    {error && <div className="support-admin-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Try again</button></div>}
    <div className="support-faq-admin-grid">
      <form className="super-admin-panel support-faq-form" onSubmit={submit}>
        <div className="support-faq-heading"><h3>{editingId ? 'Edit FAQ' : 'Create FAQ'}</h3>{editingId && <button type="button" onClick={resetForm} disabled={busy}>Cancel edit</button>}</div>
        <label>Question<textarea value={form.question} onChange={event => setForm({ ...form, question: event.target.value })} required maxLength={300} /></label>
        <label>Answer<textarea value={form.answer} onChange={event => setForm({ ...form, answer: event.target.value })} required maxLength={2000} /></label>
        <label>Category<input value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} required maxLength={80} /></label>
        <label>Keywords <small>Comma-separated, optional</small><input value={form.keywords} onChange={event => setForm({ ...form, keywords: event.target.value })} maxLength={300} /></label>
        <label>Sort order<input type="number" value={form.sortOrder} onChange={event => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label>
        <div className="support-faq-form-actions"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button><button type="button" onClick={() => setPreview(value => !value)}>{preview ? 'Hide preview' : 'Preview'}</button></div>
        {preview && <article className="support-faq-preview"><span>Preview</span><h4>{form.question || 'FAQ question'}</h4><p>{form.answer || 'FAQ answer will appear here.'}</p></article>}
      </form>
      <section className="super-admin-panel support-faq-list" aria-label="FAQs">
        <div className="support-faq-list-heading"><div><h3>FAQs</h3><span>{visibleFaqs.length} shown</span></div><label htmlFor="faq-search">Search FAQs<input id="faq-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Question, answer, category or keyword" /></label></div>
        <div className="support-faq-filters" aria-label="FAQ status filters">{(['all', 'draft', 'published'] as const).map(item => <button key={item} type="button" className={status === item ? 'active' : ''} aria-pressed={status === item} onClick={() => setStatus(item)}>{item} <b>{counts[item]}</b></button>)}</div>
        {loading ? <div className="support-faq-state" role="status">Loading FAQs…</div> : visibleFaqs.length === 0 ? <div className="support-faq-state"><strong>No FAQs found</strong><span>Try another search or status filter.</span></div> : visibleFaqs.map(faq => <article key={faq.id}><div className="support-faq-item-heading"><strong>{faq.question}</strong><span className={`support-faq-status status-${faq.status}`}>{faq.status}</span></div><p>{faq.answer}</p><small>{faq.category} · Sort {faq.sortOrder || 0}{faq.keywords?.length ? ` · ${faq.keywords.join(', ')}` : ''}</small><div className="support-faq-item-actions"><button type="button" disabled={busy} onClick={() => edit(faq)}>Edit</button><button type="button" disabled={busy} onClick={() => publish(faq, faq.status === 'published' ? 'unpublish' : 'publish')}>{faq.status === 'published' ? 'Unpublish' : 'Publish'}</button></div></article>)}
      </section>
    </div>
  </div>
}
