import { createBillingSummaryHandler } from '../api/_lib/billing-handler.js'

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function run(label, fn) {
  try {
    await fn()
    console.log(`PASS ${label}`)
  } catch (error) {
    console.error(`FAIL ${label}: ${error.message}`)
    process.exitCode = 1
  }
}

await run('authenticated new Free user without profile returns empty billing summary', async () => {
  let subscriptionCalled = false
  let invoicesCalled = false
  const handler = createBillingSummaryHandler({
    verifyIdToken: async token => token === 'valid' ? { uid: 'new-user' } : Promise.reject(new Error('bad token')),
    getProfile: async uid => uid === 'new-user' ? null : { unexpected: true },
    retrieveSubscription: async () => { subscriptionCalled = true; return null },
    listInvoices: async () => { invoicesCalled = true; return { data: [] } },
    isSmsConfigured: () => true,
  })
  const res = makeRes()
  await handler({ method: 'GET', headers: { authorization: 'Bearer valid' } }, res)
  if (res.statusCode !== 200) throw new Error(`expected 200, got ${res.statusCode}`)
  const expected = {
    subscription: null,
    invoices: [],
    canManageBilling: false,
    sms: {
      configured: true,
      status: 'inactive',
      creditsUsed: 0,
      creditsLimit: 20,
      periodStart: null,
      periodEnd: null,
    },
  }
  if (JSON.stringify(res.body) !== JSON.stringify(expected)) throw new Error(`unexpected body ${JSON.stringify(res.body)}`)
  if (subscriptionCalled || invoicesCalled) throw new Error('Stripe must not be queried for a missing profile')
})

await run('missing profile behavior does not weaken authentication', async () => {
  const handler = createBillingSummaryHandler({
    verifyIdToken: async () => { throw new Error('invalid') },
    getProfile: async () => null,
    retrieveSubscription: async () => null,
    listInvoices: async () => ({ data: [] }),
  })
  const res = makeRes()
  await handler({ method: 'GET', headers: { authorization: 'Bearer invalid' } }, res)
  if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`)
  if (res.body?.error !== 'Invalid or expired token') throw new Error(`unexpected error ${JSON.stringify(res.body)}`)
})

await run('existing profile without Stripe customer still returns normal Free summary', async () => {
  const handler = createBillingSummaryHandler({
    verifyIdToken: async () => ({ uid: 'existing-user' }),
    getProfile: async () => ({ smsAddonStatus: 'inactive', smsCreditsUsed: 2, smsCreditsLimit: 20 }),
    retrieveSubscription: async () => { throw new Error('must not be called') },
    listInvoices: async () => { throw new Error('must not be called') },
    isSmsConfigured: () => true,
  })
  const res = makeRes()
  await handler({ method: 'GET', headers: { authorization: 'Bearer valid' } }, res)
  if (res.statusCode !== 200) throw new Error(`expected 200, got ${res.statusCode}`)
  if (res.body?.canManageBilling !== false || res.body?.subscription !== null || res.body?.invoices?.length !== 0) {
    throw new Error(`unexpected existing Free summary ${JSON.stringify(res.body)}`)
  }
  if (res.body?.sms?.creditsUsed !== 2) throw new Error('existing profile SMS fields regressed')
})

if (process.exitCode) process.exit(process.exitCode)
console.log('Billing summary new-user guard: 3/3 PASS')
