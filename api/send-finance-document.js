import { FieldValue } from 'firebase-admin/firestore'
import { verifyBreeder, cleanEmail, cleanText } from './_lib/breeder-finance-auth.js'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function money(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100)
}

function titleFor(doc) {
  if (doc.type === 'invoice') return doc.seller?.gstRegistered ? 'TAX INVOICE' : 'INVOICE'
  if (doc.type === 'receipt') return 'PAYMENT RECEIPT'
  return 'REFUND RECEIPT'
}

function rowsFor(doc) {
  if (doc.type === 'invoice') {
    return [
      ['Puppy sale price', money(doc.salePriceCents)],
      ...(doc.seller?.gstRegistered ? [['GST included', money(doc.gstCents)]] : []),
      ['Deposit paid', '-' + money(doc.depositPaidCents)],
      ['Balance due', money(doc.balanceDueCents)],
    ]
  }
  if (doc.type === 'receipt') {
    return [
      ['Amount paid', money(doc.amountPaidCents)],
      ['Payment method', esc(doc.paymentMethod || 'Not specified')],
      ['Reference', esc(doc.paymentReference || '—')],
    ]
  }
  return [
    ['Amount refunded', money(doc.refundAmountCents)],
    ['Refund method', esc(doc.paymentMethod || 'Not specified')],
    ['Original document', esc(doc.originalDocumentNumber || '—')],
    ['Reason', esc(doc.refundReason || '—')],
  ]
}

function documentHtml(doc) {
  const seller = doc.seller || {}
  const buyer = doc.buyer || {}
  const dog = doc.dog || {}
  const details = rowsFor(doc).map(([label, value]) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #ece9e2;color:#5c5a54">${label}</td><td style="padding:9px 0;border-bottom:1px solid #ece9e2;text-align:right;font-weight:600">${value}</td></tr>`
  ).join('')

  return `
  <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#1a1917">
    <div style="display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #085041;padding-bottom:18px">
      <div>
        <div style="font-size:26px;font-weight:800;color:#085041">${esc(seller.businessName || 'Breeder')}</div>
        <div style="font-size:12px;line-height:1.55;color:#5c5a54;margin-top:6px">
          ${esc(seller.address || '')}${seller.address ? '<br>' : ''}
          ${esc([seller.state, seller.postcode].filter(Boolean).join(' '))}${seller.state || seller.postcode ? '<br>' : ''}
          ${esc(seller.phone || '')}${seller.phone ? '<br>' : ''}
          ${esc(seller.email || '')}
          ${seller.abn ? '<br>ABN: ' + esc(seller.abn) : ''}
          ${seller.breederId ? '<br>Breeder ID: ' + esc(seller.breederId) : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:24px;font-weight:800">${titleFor(doc)}</div>
        <div style="font-size:13px;color:#5c5a54;margin-top:8px">${esc(doc.documentNumber)}</div>
        <div style="font-size:12px;color:#5c5a54">Date: ${esc(doc.issueDate)}</div>
        ${doc.dueDate ? '<div style="font-size:12px;color:#5c5a54">Due: ' + esc(doc.dueDate) + '</div>' : ''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:24px 0">
      <div>
        <div style="font-size:11px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:6px">Buyer</div>
        <div style="font-size:15px;font-weight:700">${esc(buyer.name)}</div>
        <div style="font-size:13px;line-height:1.6;color:#5c5a54">
          ${esc(buyer.email || '')}${buyer.email ? '<br>' : ''}
          ${esc(buyer.phone || '')}${buyer.phone ? '<br>' : ''}
          ${esc(buyer.address || '')}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:6px">Dog / Puppy</div>
        <div style="font-size:15px;font-weight:700">${esc(dog.name || 'Unnamed')}</div>
        <div style="font-size:13px;line-height:1.6;color:#5c5a54">
          ${esc([dog.breed, dog.sex, dog.colour].filter(Boolean).join(' · '))}<br>
          ${dog.dateOfBirth ? 'DOB: ' + esc(dog.dateOfBirth) + '<br>' : ''}
          ${dog.microchip ? 'Microchip: ' + esc(dog.microchip) + '<br>' : ''}
          ${dog.registration ? 'Registration: ' + esc(dog.registration) : ''}
        </div>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin:16px 0 24px">${details}</table>

    ${doc.type === 'invoice' && (seller.bankBsb || seller.bankAccountNumber) ? `
      <div style="background:#f5f1e8;border-radius:10px;padding:14px 16px;margin:20px 0">
        <div style="font-weight:700;margin-bottom:5px">Payment details</div>
        <div style="font-size:13px;color:#5c5a54">
          ${esc(seller.bankAccountName || seller.businessName || '')}
          ${seller.bankBsb ? '<br>BSB: ' + esc(seller.bankBsb) : ''}
          ${seller.bankAccountNumber ? '<br>Account: ' + esc(seller.bankAccountNumber) : ''}
        </div>
      </div>` : ''}

    ${doc.notes ? '<div style="font-size:12px;color:#5c5a54;margin-top:18px"><strong>Notes:</strong> ' + esc(doc.notes) + '</div>' : ''}
    <div style="border-top:1px solid #e2dfd8;margin-top:28px;padding-top:14px;font-size:11px;color:#9a9891">
      Generated from iDogs · idogs.com.au
    </div>
  </div>`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyBreeder(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  const raw = req.body && typeof req.body === 'object' ? req.body : {}
  const documentId = cleanText(raw.documentId, 160)
  if (!documentId) return res.status(400).json({ error: 'Document is required' })

  try {
    const ref = auth.db.collection('financeDocuments').doc(documentId)
    const snap = await ref.get()
    if (!snap.exists) return res.status(404).json({ error: 'Document not found' })
    const doc = { id: snap.id, ...snap.data() }
    if (doc.tenantId !== auth.uid) return res.status(403).json({ error: 'Forbidden' })

    const toEmail = cleanEmail(raw.toEmail) || cleanEmail(doc.buyer?.email)
    if (!toEmail) return res.status(400).json({ error: 'Buyer email is required' })

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'iDogs <noreply@idogs.com.au>',
        to: [toEmail],
        subject: `${titleFor(doc)} ${doc.documentNumber} — ${doc.seller?.businessName || 'Breeder'}`,
        html: documentHtml(doc),
      }),
    })

    if (!response.ok) {
      console.error('finance document email failed', { status: response.status })
      return res.status(502).json({ error: 'Failed to send email' })
    }

    const sent = await response.json().catch(() => ({}))
    await ref.set({
      emailedAt: FieldValue.serverTimestamp(),
      emailedTo: toEmail,
      emailProviderId: cleanText(sent.id, 200),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return res.status(200).json({ success: true, toEmail })
  } catch (error) {
    console.error('finance document email error', { code: error?.code || 'unknown' })
    return res.status(500).json({ error: 'Failed to send email' })
  }
}
