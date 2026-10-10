import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getDogs } from '../lib/db'
import type { Dog, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type FinanceType = 'invoice' | 'receipt' | 'refund'

interface FinanceDocument {
  id: string
  type: FinanceType
  documentNumber: string
  issueDate: string
  dueDate?: string
  seller: Record<string, any>
  buyer: Record<string, any>
  dog: Record<string, any>
  salePriceCents: number
  gstCents: number
  depositPaidCents: number
  balanceDueCents: number
  amountPaidCents: number
  refundAmountCents: number
  paymentMethod?: string
  paymentReference?: string
  originalDocumentNumber?: string
  refundReason?: string
  notes?: string
  status: string
  emailedAt?: string | null
  emailedTo?: string
  createdAt?: string | null
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function plusDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function centsFromInput(value: string) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
}

function money(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100)
}

function typeLabel(type: FinanceType) {
  return type === 'invoice' ? 'Invoice' : type === 'receipt' ? 'Receipt' : 'Refund'
}

function documentTitle(doc: FinanceDocument) {
  if (doc.type === 'invoice') return doc.seller?.gstRegistered ? 'TAX INVOICE' : 'INVOICE'
  if (doc.type === 'receipt') return 'PAYMENT RECEIPT'
  return 'REFUND RECEIPT'
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function PrintableDocument({ doc }: { doc: FinanceDocument }) {
  const seller = doc.seller || {}
  const buyer = doc.buyer || {}
  const dog = doc.dog || {}

  return (
    <div className="finance-document-paper">
      <div className="finance-document-head">
        <div className="finance-document-business">
          <div className="finance-document-business-name">{seller.businessName || 'Breeder'}</div>
          <div style={{ fontSize: 12, color: '#5c5a54', lineHeight: 1.6, marginTop: 7 }}>
            {seller.address && <>{seller.address}<br /></>}
            {(seller.state || seller.postcode) && <>{[seller.state, seller.postcode].filter(Boolean).join(' ')}<br /></>}
            {seller.phone && <>{seller.phone}<br /></>}
            {seller.email && <>{seller.email}<br /></>}
            {seller.abn && <>ABN: {seller.abn}<br /></>}
            {seller.breederId && <>Breeder ID: {seller.breederId}</>}
          </div>
        </div>
        <div className="finance-document-title">
          <h2>{documentTitle(doc)}</h2>
          <div style={{ color: '#5c5a54', marginTop: 6 }}>{doc.documentNumber}</div>
          <div style={{ fontSize: 12, color: '#5c5a54' }}>Date: {doc.issueDate}</div>
          {doc.dueDate && <div style={{ fontSize: 12, color: '#5c5a54' }}>Due: {doc.dueDate}</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24, margin: '24px 0' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 6 }}>Buyer</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{buyer.name}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: '#5c5a54' }}>
            {buyer.email && <>{buyer.email}<br /></>}
            {buyer.phone && <>{buyer.phone}<br /></>}
            {buyer.address}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 6 }}>Dog / Puppy</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{dog.name || 'Unnamed'}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: '#5c5a54' }}>
            {[dog.breed, dog.sex, dog.colour].filter(Boolean).join(' · ')}<br />
            {dog.dateOfBirth && <>DOB: {dog.dateOfBirth}<br /></>}
            {dog.microchip && <>Microchip: {dog.microchip}<br /></>}
            {dog.registration && <>Registration: {dog.registration}</>}
          </div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <tbody>
          {doc.type === 'invoice' && <>
            <tr><td style={rowLabel}>Puppy sale price</td><td style={rowValue}>{money(doc.salePriceCents)}</td></tr>
            {seller.gstRegistered && <tr><td style={rowLabel}>GST included</td><td style={rowValue}>{money(doc.gstCents)}</td></tr>}
            <tr><td style={rowLabel}>Deposit paid</td><td style={rowValue}>− {money(doc.depositPaidCents)}</td></tr>
            <tr><td style={{ ...rowLabel, fontWeight: 700, color: '#1a1917' }}>Balance due</td><td style={{ ...rowValue, fontSize: 18, color: '#085041' }}>{money(doc.balanceDueCents)}</td></tr>
          </>}
          {doc.type === 'receipt' && <>
            <tr><td style={rowLabel}>Amount paid</td><td style={{ ...rowValue, fontSize: 18, color: '#085041' }}>{money(doc.amountPaidCents)}</td></tr>
            <tr><td style={rowLabel}>Payment method</td><td style={rowValue}>{doc.paymentMethod || 'Not specified'}</td></tr>
            <tr><td style={rowLabel}>Transaction reference</td><td style={rowValue}>{doc.paymentReference || '—'}</td></tr>
          </>}
          {doc.type === 'refund' && <>
            <tr><td style={rowLabel}>Amount refunded</td><td style={{ ...rowValue, fontSize: 18, color: '#b42318' }}>{money(doc.refundAmountCents)}</td></tr>
            <tr><td style={rowLabel}>Refund method</td><td style={rowValue}>{doc.paymentMethod || 'Not specified'}</td></tr>
            <tr><td style={rowLabel}>Original document</td><td style={rowValue}>{doc.originalDocumentNumber || '—'}</td></tr>
            <tr><td style={rowLabel}>Reason</td><td style={rowValue}>{doc.refundReason || '—'}</td></tr>
          </>}
        </tbody>
      </table>

      {doc.type === 'invoice' && (seller.bankBsb || seller.bankAccountNumber) && (
        <div style={{ marginTop: 20, padding: 14, background: '#f5f1e8', borderRadius: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Payment details</div>
          <div style={{ fontSize: 13, color: '#5c5a54', lineHeight: 1.55 }}>
            {seller.bankAccountName || seller.businessName}
            {seller.bankBsb && <><br />BSB: {seller.bankBsb}</>}
            {seller.bankAccountNumber && <><br />Account: {seller.bankAccountNumber}</>}
          </div>
        </div>
      )}

      {doc.notes && <div style={{ marginTop: 20, fontSize: 12, color: '#5c5a54' }}><strong>Notes:</strong> {doc.notes}</div>}
      <div style={{ borderTop: '1px solid #e2dfd8', marginTop: 28, paddingTop: 14, fontSize: 11, color: '#9a9891' }}>
        Generated from iDogs · idogs.com.au
      </div>
    </div>
  )
}

const rowLabel: React.CSSProperties = { padding: '10px 0', borderBottom: '1px solid #ece9e2', color: '#5c5a54' }
const rowValue: React.CSSProperties = { padding: '10px 0', borderBottom: '1px solid #ece9e2', textAlign: 'right', fontWeight: 600 }

export default function FinanceDocumentsPage({ toast }: Props) {
  const { user, profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [dogs, setDogs] = useState<Dog[]>([])
  const [documents, setDocuments] = useState<FinanceDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [viewing, setViewing] = useState<FinanceDocument | null>(null)
  const [printDoc, setPrintDoc] = useState<FinanceDocument | null>(null)
  const [type, setType] = useState<FinanceType>('invoice')
  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState('')
  const [dogId, setDogId] = useState(searchParams.get('dogId') || '')
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState(plusDays(today(), 7))
  const [salePrice, setSalePrice] = useState('')
  const [depositPaid, setDepositPaid] = useState('')
  const [amountPaid, setAmountPaid] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('Bank transfer')
  const [paymentReference, setPaymentReference] = useState('')
  const [originalDocumentNumber, setOriginalDocumentNumber] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [notes, setNotes] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [buyerAddress, setBuyerAddress] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [abn, setAbn] = useState('')
  const [gstRegistered, setGstRegistered] = useState(false)
  const [bankAccountName, setBankAccountName] = useState('')
  const [bankBsb, setBankBsb] = useState('')
  const [bankAccountNumber, setBankAccountNumber] = useState('')

  async function token() {
    if (!user) throw new Error('Not signed in')
    return user.getIdToken()
  }

  async function load() {
    if (!user) return
    setLoading(true)
    try {
      const [dogRows, idToken] = await Promise.all([getDogs(), token()])
      setDogs(dogRows)
      const res = await fetch('/api/breeder-finance-documents', { headers: { Authorization: `Bearer ${idToken}` } })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      setDocuments(Array.isArray(json.documents) ? json.documents : [])
    } catch {
      toast('Could not load invoices and payments.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user?.uid])

  useEffect(() => {
    if (!profile) return
    setBusinessName((profile as any).businessName || profile.kennelName || [profile.firstName, profile.lastName].filter(Boolean).join(' '))
    setAbn((profile as any).abn || '')
    setGstRegistered((profile as any).gstRegistered === true)
    setBankAccountName((profile as any).bankAccountName || '')
    setBankBsb((profile as any).bankBsb || '')
    setBankAccountNumber((profile as any).bankAccountNumber || '')
  }, [profile?.uid])

  const selectedDog = useMemo(() => dogs.find(d => d.id === dogId), [dogs, dogId])

  useEffect(() => {
    if (!selectedDog) return
    const transferred = !!selectedDog.transferredAt
    setBuyerName(transferred ? selectedDog.buyerName || '' : selectedDog.reservedForName || '')
    setBuyerEmail(transferred ? selectedDog.buyerEmail || '' : selectedDog.reservedForEmail || '')
    setBuyerPhone(transferred ? selectedDog.buyerPhone || '' : selectedDog.reservedForPhone || '')
    if (!depositPaid && selectedDog.depositAmount) setDepositPaid(String(selectedDog.depositAmount))
  }, [dogId])

  function startCreate(nextType: FinanceType) {
    setType(nextType)
    setIssueDate(today())
    setDueDate(plusDays(today(), 7))
    setPaymentReference('')
    setOriginalDocumentNumber('')
    setRefundReason('')
    setNotes('')
    setShowCreate(true)
  }

  async function createDocument() {
    if (!dogId || !buyerName.trim()) {
      toast('Select a dog and enter the buyer name.', 'error')
      return
    }
    setSaving(true)
    try {
      const idToken = await token()
      const res = await fetch('/api/breeder-finance-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          type, dogId, issueDate, dueDate,
          salePriceCents: centsFromInput(salePrice),
          depositPaidCents: centsFromInput(depositPaid),
          amountPaidCents: centsFromInput(amountPaid),
          refundAmountCents: centsFromInput(refundAmount),
          paymentMethod, paymentReference, originalDocumentNumber, refundReason, notes,
          buyer: { name: buyerName, email: buyerEmail, phone: buyerPhone, address: buyerAddress },
          seller: {
            businessName,
            contactName: [profile?.firstName, profile?.lastName].filter(Boolean).join(' '),
            email: profile?.email,
            phone: profile?.phone,
            address: profile?.address,
            state: profile?.state,
            postcode: profile?.postcode,
            abn,
            breederId: profile?.breederIdValue,
            gstRegistered,
            bankAccountName,
            bankBsb,
            bankAccountNumber,
          },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to create document')
      setDocuments(prev => [json.document, ...prev])
      setViewing(json.document)
      setShowCreate(false)
      toast(`${typeLabel(type)} ${json.document.documentNumber} created.`, 'success')
    } catch (err: any) {
      toast(err.message || 'Could not create document.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function sendEmail(doc: FinanceDocument) {
    const email = doc.buyer?.email
    if (!email) {
      toast('Add the buyer email before sending.', 'error')
      return
    }
    setSendingId(doc.id)
    try {
      const idToken = await token()
      const res = await fetch('/api/send-finance-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ documentId: doc.id, toEmail: email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to send email')
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, emailedAt: new Date().toISOString(), emailedTo: email } : d))
      if (viewing?.id === doc.id) setViewing({ ...doc, emailedAt: new Date().toISOString(), emailedTo: email })
      toast(`${doc.documentNumber} emailed to ${email}.`, 'success')
    } catch (err: any) {
      toast(err.message || 'Could not send email.', 'error')
    } finally {
      setSendingId('')
    }
  }

  function printDocumentLegacy(doc: FinanceDocument) {
    const seller = doc.seller || {}
    const buyer = doc.buyer || {}
    const dog = doc.dog || {}
    const lines = doc.type === 'invoice'
      ? [
          ['Puppy sale price', money(doc.salePriceCents)],
          ...(seller.gstRegistered ? [['GST included', money(doc.gstCents)]] : []),
          ['Deposit paid', '− ' + money(doc.depositPaidCents)],
          ['Balance due', money(doc.balanceDueCents)],
        ]
      : doc.type === 'receipt'
        ? [['Amount paid', money(doc.amountPaidCents)], ['Payment method', doc.paymentMethod || 'Not specified'], ['Reference', doc.paymentReference || '—']]
        : [['Amount refunded', money(doc.refundAmountCents)], ['Refund method', doc.paymentMethod || 'Not specified'], ['Original document', doc.originalDocumentNumber || '—'], ['Reason', doc.refundReason || '—']]

    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.border = '0'
    frame.style.opacity = '0'
    document.body.appendChild(frame)

    const win = frame.contentWindow
    if (!win) {
      frame.remove()
      toast('Could not open the print preview.', 'error')
      return
    }
    win.document.open()
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(doc.documentNumber)}</title>
      <style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1a1917;margin:0;padding:24px;max-width:820px;margin-inline:auto}.head{display:grid;grid-template-columns:minmax(0,1fr) minmax(210px,280px);gap:32px;align-items:start;border-bottom:3px solid #085041;padding-bottom:18px}.head>div:first-child{min-width:0}.head>div:last-child{text-align:right;min-width:0}.brand{font-size:26px;line-height:1.18;font-weight:800;color:#085041;overflow-wrap:anywhere}.muted{font-size:12px;color:#5c5a54;line-height:1.6;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:26px 0}.cap{font-size:11px;color:#777;font-weight:700;text-transform:uppercase}.name{font-size:15px;font-weight:700;margin:5px 0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td{padding:10px 0;border-bottom:1px solid #ece9e2}td:last-child{text-align:right;font-weight:700}.bank{margin-top:20px;padding:14px;background:#f5f1e8;border-radius:10px}.foot{margin-top:28px;padding-top:14px;border-top:1px solid #e2dfd8;font-size:11px;color:#999}@media(max-width:620px){.head,.grid{grid-template-columns:1fr}.head>div:last-child{text-align:left}}@media print{body{padding:0;max-width:none}.head,.grid{break-inside:avoid}.bank{break-inside:avoid}}</style>
      </head><body><div class="head"><div><div class="brand">${escapeHtml(seller.businessName || 'Breeder')}</div><div class="muted">${escapeHtml(seller.address || '')}<br>${escapeHtml([seller.state,seller.postcode].filter(Boolean).join(' '))}<br>${escapeHtml(seller.phone || '')}<br>${escapeHtml(seller.email || '')}${seller.abn ? '<br>ABN: '+escapeHtml(seller.abn):''}${seller.breederId ? '<br>Breeder ID: '+escapeHtml(seller.breederId):''}</div></div><div style="text-align:right"><div style="font-size:24px;font-weight:800">${documentTitle(doc)}</div><div class="muted">${escapeHtml(doc.documentNumber)}<br>Date: ${escapeHtml(doc.issueDate)}${doc.dueDate?'<br>Due: '+escapeHtml(doc.dueDate):''}</div></div></div>
      <div class="grid"><div><div class="cap">Buyer</div><div class="name">${escapeHtml(buyer.name)}</div><div class="muted">${escapeHtml(buyer.email||'')}<br>${escapeHtml(buyer.phone||'')}<br>${escapeHtml(buyer.address||'')}</div></div><div><div class="cap">Dog / Puppy</div><div class="name">${escapeHtml(dog.name||'Unnamed')}</div><div class="muted">${escapeHtml([dog.breed,dog.sex,dog.colour].filter(Boolean).join(' · '))}<br>${dog.dateOfBirth?'DOB: '+escapeHtml(dog.dateOfBirth)+'<br>':''}${dog.microchip?'Microchip: '+escapeHtml(dog.microchip)+'<br>':''}${dog.registration?'Registration: '+escapeHtml(dog.registration):''}</div></div></div>
      <table>${lines.map(([a,b])=>`<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join('')}</table>
      ${doc.type==='invoice'&&(seller.bankBsb||seller.bankAccountNumber)?`<div class="bank"><b>Payment details</b><div class="muted">${escapeHtml(seller.bankAccountName||seller.businessName||'')}${seller.bankBsb?'<br>BSB: '+escapeHtml(seller.bankBsb):''}${seller.bankAccountNumber?'<br>Account: '+escapeHtml(seller.bankAccountNumber):''}</div></div>`:''}
      ${doc.notes?'<div class="muted" style="margin-top:18px"><b>Notes:</b> '+escapeHtml(doc.notes)+'</div>':''}<div class="foot">Generated from iDogs · idogs.com.au</div>
      </body></html>`)
    win.document.close()
    window.setTimeout(() => {
      try {
        win.focus()
        win.print()
      } finally {
        window.setTimeout(() => frame.remove(), 1500)
      }
    }, 250)
  }

  function printDocument(doc: FinanceDocument) {
    setPrintDoc(doc)
    window.setTimeout(() => {
      window.print()
    }, 120)
  }

  useEffect(() => {
    const clearPrintDoc = () => setPrintDoc(null)
    window.addEventListener('afterprint', clearPrintDoc)
    return () => window.removeEventListener('afterprint', clearPrintDoc)
  }, [])

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, margin: 0, color: 'var(--dark)' }}>Invoices & Payments</h1>
          <p style={{ margin: '5px 0 0', color: 'var(--mid)', maxWidth: 680 }}>
            Create professional invoices, payment receipts and refund receipts for puppy buyers. Print or save as PDF, and send directly by email.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => startCreate('invoice')}>＋ Invoice</button>
          <button className="btn btn-secondary" onClick={() => startCreate('receipt')}>＋ Receipt</button>
          <button className="btn btn-secondary" onClick={() => startCreate('refund')}>＋ Refund</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>How this works</div>
        <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>
          Seller and puppy details are pre-filled from iDogs. Buyer details are pre-filled from the reservation/transfer where available. “Tax Invoice” is shown only when GST registered is selected.
        </div>
      </div>

      {loading ? (
        <div className="card"><p style={{ margin: 0, color: 'var(--mid)' }}>Loading finance documents…</p></div>
      ) : documents.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 38 }}>🧾</div>
          <h3 style={{ margin: '10px 0 6px' }}>No finance documents yet</h3>
          <p style={{ color: 'var(--mid)', margin: 0 }}>Create your first invoice, receipt or refund receipt.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--mid)' }}>
                <th style={{ padding: 14 }}>Document</th><th>Buyer</th><th>Dog</th><th>Amount</th><th>Date</th><th>Status</th><th style={{ paddingRight: 14 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 14 }}><strong>{doc.documentNumber}</strong><div style={{ color: 'var(--mid)', fontSize: 11 }}>{typeLabel(doc.type)}</div></td>
                  <td>{doc.buyer?.name || '—'}<div style={{ color: 'var(--mid)', fontSize: 11 }}>{doc.buyer?.email || ''}</div></td>
                  <td>{doc.dog?.name || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{doc.type === 'invoice' ? money(doc.balanceDueCents) : doc.type === 'receipt' ? money(doc.amountPaidCents) : money(doc.refundAmountCents)}</td>
                  <td>{doc.issueDate}</td>
                  <td><span className={doc.type === 'refund' ? 'badge badge-gray' : 'badge badge-green'}>{doc.status}</span>{doc.emailedAt && <div style={{ fontSize: 10, color: 'var(--mid)', marginTop: 3 }}>emailed</div>}</td>
                  <td style={{ paddingRight: 14 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setViewing(doc)}>View</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => printDocument(doc)}>Print/PDF</button>
                      <button className="btn btn-sm btn-primary" disabled={sendingId === doc.id || !doc.buyer?.email} onClick={() => sendEmail(doc)}>
                        {sendingId === doc.id ? 'Sending…' : 'Email'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="finance-modal-overlay" onMouseDown={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="finance-modal-shell">
            <div className="finance-modal-header">
              <div>
                <div style={{ fontSize: 12, color: '#0c725d', fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase' }}>Breeder finance</div>
                <h2 style={{ margin: '4px 0 0', fontSize: 24 }}>Create {typeLabel(type)}</h2>
                <p style={{ margin: '5px 0 0', color: 'var(--mid)', fontSize: 13 }}>Buyer and puppy details are pre-filled where available.</p>
              </div>
              <button className="finance-modal-close" aria-label="Close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="finance-modal-body">
              <section className="finance-form-section">
                <div className="finance-form-section-title">① Dog & buyer</div>
                <div className="finance-form-grid">
                  <div className="form-group finance-span-2"><label className="form-label">Dog / Puppy *</label><select className="form-select" value={dogId} onChange={e => setDogId(e.target.value)}><option value="">Select dog</option>{dogs.filter(d => d.tenantId === user?.uid).map(d => <option key={d.id} value={d.id}>{d.name || 'Unnamed'} — {d.breed}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Buyer name *</label><input className="form-input" value={buyerName} onChange={e => setBuyerName(e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">Buyer email</label><input className="form-input" type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">Buyer phone</label><input className="form-input" value={buyerPhone} onChange={e => setBuyerPhone(e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">Buyer address</label><input className="form-input" value={buyerAddress} onChange={e => setBuyerAddress(e.target.value)} /></div>
                </div>
              </section>

              <section className="finance-form-section">
                <div className="finance-form-section-title">② Seller details</div>
                <div className="finance-form-grid">
                  <div className="form-group"><label className="form-label">Business / kennel name</label><input className="form-input" value={businessName} onChange={e => setBusinessName(e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">ABN</label><input className="form-input" value={abn} onChange={e => setAbn(e.target.value)} placeholder="Optional" /></div>
                  <label className="finance-gst-toggle finance-span-2"><input type="checkbox" checked={gstRegistered} onChange={e => setGstRegistered(e.target.checked)} /><span><strong>GST registered</strong><br />Show “Tax Invoice” and calculate GST included in the total.</span></label>
                </div>
              </section>

              <section className="finance-form-section">
                <div className="finance-form-section-title">③ Document details</div>
                <div className="finance-form-grid">
                  <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
                  {type === 'invoice' && <div className="form-group"><label className="form-label">Due date</label><input className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>}
                  {type === 'invoice' && <><div className="form-group"><label className="form-label">Puppy sale price (AUD) *</label><input className="form-input" inputMode="decimal" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="2500.00" /></div><div className="form-group"><label className="form-label">Deposit already paid</label><input className="form-input" inputMode="decimal" value={depositPaid} onChange={e => setDepositPaid(e.target.value)} placeholder="500.00" /></div></>}
                  {type === 'receipt' && <div className="form-group"><label className="form-label">Amount paid (AUD) *</label><input className="form-input" inputMode="decimal" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder="500.00" /></div>}
                  {type === 'refund' && <div className="form-group"><label className="form-label">Amount refunded (AUD) *</label><input className="form-input" inputMode="decimal" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} placeholder="500.00" /></div>}
                  {type !== 'invoice' && <div className="form-group"><label className="form-label">{type === 'refund' ? 'Refund method' : 'Payment method'}</label><select className="form-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option>Bank transfer</option><option>Cash</option><option>Card</option><option>PayID</option><option>Other</option></select></div>}
                  {type === 'receipt' && <div className="form-group"><label className="form-label">Transaction reference</label><input className="form-input" value={paymentReference} onChange={e => setPaymentReference(e.target.value)} /></div>}
                  {type === 'refund' && <><div className="form-group"><label className="form-label">Original invoice / receipt no.</label><input className="form-input" value={originalDocumentNumber} onChange={e => setOriginalDocumentNumber(e.target.value)} /></div><div className="form-group finance-span-2"><label className="form-label">Refund reason</label><input className="form-input" value={refundReason} onChange={e => setRefundReason(e.target.value)} /></div></>}
                </div>
              </section>

              {type === 'invoice' && (
                <section className="finance-form-section">
                  <div className="finance-form-section-title">④ Payment details</div>
                  <div className="finance-form-grid">
                    <div className="form-group"><label className="form-label">Account name</label><input className="form-input" value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">BSB</label><input className="form-input" value={bankBsb} onChange={e => setBankBsb(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Account number</label><input className="form-input" value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} /></div>
                  </div>
                </section>
              )}

              <section className="finance-form-section">
                <div className="finance-form-section-title">{type === 'invoice' ? '⑤' : '④'} Notes & terms</div>
                <div className="form-group"><label className="form-label">Notes / terms</label><textarea className="form-textarea" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder={type === 'invoice' ? 'e.g. Puppy to be collected after full payment.' : 'Optional notes'} /></div>
              </section>
            </div>
            <div className="finance-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={createDocument}>{saving ? 'Creating…' : `Create ${typeLabel(type)}`}</button>
            </div>
          </div>
        </div>
      )}

      {printDoc && (
        <div className="finance-print-root" aria-hidden="true">
          <PrintableDocument doc={printDoc} />
        </div>
      )}

      {viewing && (
        <div className="finance-modal-overlay" onMouseDown={e => e.target === e.currentTarget && setViewing(null)}>
          <div className="finance-modal-shell finance-document-preview-shell">
            <div className="finance-modal-header">
              <div>
                <div style={{ fontSize: 12, color: '#0c725d', fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase' }}>Document preview</div>
                <div style={{ marginTop: 4, fontSize: 19, fontWeight: 800 }}>{documentTitle(viewing)}</div>
                <div style={{ marginTop: 3, color: 'var(--mid)', fontSize: 12 }}><strong>{viewing.documentNumber}</strong>{viewing.emailedAt && <span className="badge badge-green" style={{ marginLeft: 8 }}>Emailed</span>}</div>
              </div>
              <button className="finance-modal-close" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
            <div className="finance-modal-body finance-document-preview-body"><PrintableDocument doc={viewing} /></div>
            <div className="finance-preview-actions">
              <button className="btn btn-secondary" onClick={() => printDocument(viewing)}>Print / Save PDF</button>
              <button className="btn btn-primary" disabled={sendingId === viewing.id || !viewing.buyer?.email} onClick={() => sendEmail(viewing)}>{sendingId === viewing.id ? 'Sending…' : 'Send email'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
const sectionTitle: React.CSSProperties = { fontWeight: 700, fontSize: 13, color: '#085041', borderBottom: '1px solid var(--border)', paddingBottom: 6, margin: '18px 0 12px', textTransform: 'uppercase', letterSpacing: '.04em' }
