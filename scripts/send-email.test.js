import { describe, expect, it, vi } from 'vitest'
import { createSendEmailHandler, safeActionUrl, escapeHtml } from '../api/_lib/send-email-handler.js'

function mockRes() {
  const r = { statusCode: 0, body: undefined }
  r.status = c => { r.statusCode = c; return r }
  r.json = b => { r.body = b; return r }
  return r
}

const DOGS = {
  d1: { name: 'Rex', breed: 'Kelpie', previousOwnerId: 'breeder1', transferStatus: 'pendingClaim', buyerEmail: 'buyer@example.com', buyerName: 'Sam' },
  d2: { name: 'Old', breed: 'Pug', previousOwnerId: 'breeder1', transferStatus: 'claimed', buyerEmail: 'past@example.com' },
}

function setup({ decoded = { uid: 'breeder1', email: 'me@example.com', email_verified: true } } = {}) {
  const sent = []
  const handler = createSendEmailHandler({
    verifyIdToken: vi.fn(async t => { if (t !== 'good') throw new Error('bad'); return decoded }),
    getDog: async id => DOGS[id] || null,
    sendEmail: async payload => { sent.push(payload); return { ok: true, id: 'e1' } },
    cronSecret: () => 'cron-s3cret',
  })
  return { handler, sent }
}
const user = body => ({ method: 'POST', headers: { authorization: 'Bearer good' }, body })

describe('/api/send-email — no open relay', () => {
  it('rejects unauthenticated and bad-token requests', async () => {
    const { handler, sent } = setup()
    let res = mockRes(); await handler({ method: 'POST', headers: {}, body: { to_email: 'x@evil.test', subject: 's', message: 'm' } }, res)
    expect(res.statusCode).toBe(401)
    res = mockRes(); await handler({ method: 'POST', headers: { authorization: 'Bearer nope' }, body: {} }, res)
    expect(res.statusCode).toBe(401)
    res = mockRes(); await handler({ method: 'POST', headers: { 'x-cron-secret': 'wrong' }, body: { to_email: 'x@evil.test', subject: 's', message: 'm' } }, res)
    expect(res.statusCode).toBe(401)
    expect(sent).toHaveLength(0)
  })

  it('refuses the old free-form payload from a signed-in user', async () => {
    const { handler, sent } = setup()
    const res = mockRes()
    await handler(user({ to_email: 'victim@example.com', subject: 'Reset your password', message: '<a href="https://evil.test">click</a>', action_url: 'https://evil.test' }), res)
    expect(res.statusCode).toBe(403)
    expect(sent).toHaveLength(0)
  })

  it('sends a transfer email only to the pending buyer of a dog the caller transferred', async () => {
    const { handler, sent } = setup()
    const res = mockRes()
    await handler(user({ kind: 'transfer', dogId: 'd1', to_email: 'victim@example.com', to_name: 'Sam', breederName: 'Ann <b>Kennels</b>' }), res)
    expect(res.statusCode).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual(['buyer@example.com']) // caller-supplied to_email ignored
    expect(sent[0].from).toBe('iDogs <noreply@idogs.com.au>')
    expect(sent[0].html).toContain('href="https://idogs.com.au/login"')
    expect(sent[0].html).not.toContain('<b>Kennels</b>')
    expect(sent[0].html).toContain('Ann &lt;b&gt;Kennels&lt;/b&gt;')
  })

  it('refuses transfer emails for dogs the caller did not transfer or that are no longer pending', async () => {
    const other = setup({ decoded: { uid: 'someoneElse' } })
    let res = mockRes(); await other.handler(user({ kind: 'transfer', dogId: 'd1' }), res)
    expect(res.statusCode).toBe(403)
    const owner = setup()
    res = mockRes(); await owner.handler(user({ kind: 'transfer', dogId: 'd2' }), res)
    expect(res.statusCode).toBe(403)
    res = mockRes(); await owner.handler(user({ kind: 'transfer', dogId: 'missing' }), res)
    expect(res.statusCode).toBe(403)
    expect(other.sent.length + owner.sent.length).toBe(0)
  })

  it('sends a reminder digest only to the caller’s own verified email, escaped', async () => {
    const { handler, sent } = setup()
    const res = mockRes()
    await handler(user({ kind: 'reminder_digest', to_email: 'victim@example.com', date: '22 Nov\r\nBcc: x', reminders: '• Rex — <script>alert(1)</script>' }), res)
    expect(res.statusCode).toBe(200)
    expect(sent[0].to).toEqual(['me@example.com'])
    expect(sent[0].subject).not.toMatch(/[\r\n]/)
    expect(sent[0].html).not.toContain('<script>')
  })

  it('refuses a reminder digest without a verified email', async () => {
    const { handler, sent } = setup({ decoded: { uid: 'u2', email: 'x@example.com', email_verified: false } })
    const res = mockRes(); await handler(user({ kind: 'reminder_digest', reminders: 'x' }), res)
    expect(res.statusCode).toBe(403)
    expect(sent).toHaveLength(0)
  })

  it('still lets the cron sender deliver server-composed HTML, but drops off-site links', async () => {
    const { handler, sent } = setup()
    const res = mockRes()
    await handler({ method: 'POST', headers: { 'x-cron-secret': 'cron-s3cret' }, body: { to_email: 'owner@example.com', subject: 'Vaccine due', message: '<p>Hi</p>', action_url: 'https://evil.test/x' } }, res)
    expect(res.statusCode).toBe(200)
    expect(sent[0].html).toContain('<p>Hi</p>')
    expect(sent[0].html).not.toContain('evil.test')
  })
})

describe('helpers', () => {
  it('allows only https idogs.com.au links', () => {
    expect(safeActionUrl('https://idogs.com.au/app/reminders')).toBe('https://idogs.com.au/app/reminders')
    expect(safeActionUrl('https://staging.idogs.com.au/x')).toBe('https://staging.idogs.com.au/x')
    expect(safeActionUrl('http://idogs.com.au/x')).toBeNull()
    expect(safeActionUrl('https://idogs.com.au.evil.test/x')).toBeNull()
    expect(safeActionUrl('javascript:alert(1)')).toBeNull()
  })
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
