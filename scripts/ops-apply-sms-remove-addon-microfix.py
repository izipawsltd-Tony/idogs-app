from pathlib import Path

expected = 'e4dfdf9a196871f0801775ee7ead28fa4e302bb1'

remove_api = '''import Stripe from 'stripe'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createSmsAddonRemoveHandler } from './_lib/sms-checkout-handler.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\\\n/g, '\\n'),
    }),
  })
}
const db = getFirestore()

export default createSmsAddonRemoveHandler({
  verifyIdToken: token => getAuth().verifyIdToken(token),
  getProfile: async uid => {
    const snap = await db.collection('users').doc(uid).get()
    return snap.exists ? snap.data() : null
  },
  retrieveSubscription: id => stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }),
  updateSubscription: (id, params) => stripe.subscriptions.update(id, params),
})
'''
Path('api/remove-sms-addon.js').write_text(remove_api)

handler = Path('api/_lib/sms-checkout-handler.js')
text = handler.read_text()
if 'export function createSmsAddonRemoveHandler' in text:
    raise SystemExit('STOP remove handler already exists')
text += r'''

export function createSmsAddonRemoveHandler({
  verifyIdToken,
  getProfile,
  retrieveSubscription,
  updateSubscription,
  getPriceId = () => process.env.STRIPE_SMS_ADDON_PRICE_ID,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const priceId = getPriceId()
    if (!priceId || typeof priceId !== 'string') {
      logConfigError('remove-sms-addon', 'SMS_PRICE_NOT_CONFIGURED')
      return res.status(503).json({ error: 'SMS add-on is not configured' })
    }

    const authHeader = req.headers?.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Missing Authorization header' })

    let identity
    try { identity = await verifyIdToken(token) } catch {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    if (!identity?.uid) return res.status(401).json({ error: 'Authenticated identity is incomplete' })

    const body = parseBody(req)
    if (body.priceId !== undefined || body.userId !== undefined || body.subscriptionId !== undefined || body.itemId !== undefined) {
      return res.status(400).json({ error: 'Unsupported add-on fields' })
    }

    try {
      const profile = await getProfile(identity.uid)
      if (!profile) return res.status(404).json({ error: 'Profile not found' })
      if (computeEffectivePlan(profile) !== 'plus') {
        return res.status(403).json({ error: 'iDogs Plus is required for the SMS add-on' })
      }
      if (!profile.stripeCustomerId || !profile.stripeSubscriptionId) {
        return reject409(res, 'SMS_REMOVE_MISSING_BILLING_LINK', 'An active Stripe Plus subscription is required')
      }

      const subscription = await retrieveSubscription(profile.stripeSubscriptionId)
      if (!subscription || subscription.id !== profile.stripeSubscriptionId) {
        return reject409(res, 'SMS_REMOVE_SUBSCRIPTION_VERIFY', 'Plus subscription could not be verified')
      }
      if (customerIdOf(subscription) !== profile.stripeCustomerId) {
        return reject409(res, 'SMS_REMOVE_CUSTOMER_MISMATCH', 'Stripe customer mismatch')
      }
      if (!hasBasePlusPrice(subscription)) {
        return reject409(res, 'SMS_REMOVE_PLUS_PRICE_MISMATCH', 'Verified iDogs Plus price not found on subscription')
      }

      const smsItem = (subscription.items?.data || []).find(item => item?.price?.id === priceId)
      if (!smsItem?.id) {
        return reject409(res, 'SMS_REMOVE_ALREADY_ABSENT', 'SMS add-on is already removed')
      }

      await updateSubscription(subscription.id, {
        items: [{ id: smsItem.id, deleted: true }],
        proration_behavior: 'always_invoice',
      })

      return res.status(200).json({ success: true, status: 'removing' })
    } catch (err) {
      logSanitizedError('remove-sms-addon', 'SMS_REMOVE_FAILED', { code: err?.code })
      return res.status(500).json({ error: 'Failed to remove SMS from your Plus subscription' })
    }
  }
}
'''
handler.write_text(text)

billing = Path('src/pages/BillingPage.tsx')
text = billing.read_text()
old = "  const [smsCheckoutLoading, setSmsCheckoutLoading] = useState(false)\n"
new = old + "  const [smsRemoveLoading, setSmsRemoveLoading] = useState(false)\n"
if text.count(old) != 1:
    raise SystemExit(f'STOP smsRemoveLoading anchor count={text.count(old)}')
text = text.replace(old, new)

old = """    if (searchParams.get('sms_cancelled')) {\n      toast('SMS add-on checkout cancelled.', 'info')\n    }\n"""
new = old + """    if (searchParams.get('sms_removed')) {\n      toast('SMS add-on removed. Your iDogs Plus subscription remains active.', 'success')\n    }\n"""
if text.count(old) != 1:
    raise SystemExit(f'STOP sms_removed toast anchor count={text.count(old)}')
text = text.replace(old, new)

idx = text.find('  async function handleSmsSubscribe() {')
insert_at = text.find('\n  return (\n', idx)
if idx < 0 or insert_at < 0:
    raise SystemExit('STOP BillingPage function anchors not found')
remove_fn = r'''

  async function handleSmsRemove() {
    if (!user || smsRemoveLoading) return
    const confirmed = window.confirm('Remove the SMS add-on? Your iDogs Plus subscription will stay active.')
    if (!confirmed) return

    setSmsRemoveLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/remove-sms-addon', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to remove SMS add-on')

      setBillingDetails(current => current ? {
        ...current,
        sms: {
          ...current.sms,
          status: 'cancelled',
          periodStart: null,
          periodEnd: null,
        },
      } : current)
      toast('SMS add-on removed. Your iDogs Plus subscription remains active.', 'success')
    } catch {
      toast('Failed to remove SMS add-on. Please try again.', 'error')
    } finally {
      setSmsRemoveLoading(false)
    }
  }
'''
text = text[:insert_at] + remove_fn + text[insert_at:]

old = """                {billingDetails?.sms.status === 'active' || billingDetails?.sms.status === 'past_due' ? (\n                  <button className=\"btn btn-secondary\" type=\"button\" onClick={handleOpenPortal} disabled={portalLoading}>\n                    {portalLoading ? 'Opening…' : 'Manage SMS add-on'}\n                  </button>\n"""
new = """                {billingDetails?.sms.status === 'active' || billingDetails?.sms.status === 'past_due' ? (\n                  <button className=\"btn btn-secondary\" type=\"button\" onClick={handleSmsRemove} disabled={smsRemoveLoading}>\n                    {smsRemoveLoading ? 'Removing SMS…' : 'Remove SMS add-on'}\n                  </button>\n"""
if text.count(old) != 1:
    raise SystemExit(f'STOP active SMS button replacement count={text.count(old)}')
text = text.replace(old, new)
billing.write_text(text)

test = Path('scripts/test-sms-addon-v1.mjs')
text = test.read_text()
old = "import { createSmsAddonCheckoutHandler } from '../api/_lib/sms-checkout-handler.js'\n"
new = "import { createSmsAddonCheckoutHandler, createSmsAddonRemoveHandler } from '../api/_lib/sms-checkout-handler.js'\n"
if text.count(old) != 1:
    raise SystemExit(f'STOP test import replacement count={text.count(old)}')
text = text.replace(old, new)
marker = "\nconsole.log(`SMS Add-on V1: ${passed}/${passed} PASS`)"
if text.count(marker) != 1:
    raise SystemExit('STOP test footer marker not found')
tests = r'''

await check('Remove SMS add-on deletes only the verified SMS subscription item and keeps Plus', async () => {
  let called=null
  const handler=createSmsAddonRemoveHandler({
    verifyIdToken:async()=>({uid:'u1'}),
    getProfile:async()=>({plan:'plus',subscriptionStatus:'active',stripeCustomerId:'cus_1',stripeSubscriptionId:'sub_1'}),
    retrieveSubscription:async()=>({id:'sub_1',customer:'cus_1',items:{data:[
      {id:'si_plus',price:{id:'price_1TxaNJGHgBd6ZgJEpAhrWark'}},
      {id:'si_sms',price:{id:'price_sms'}},
    ]}}),
    updateSubscription:async(id,params)=>{ called={id,params}; return {id} },
    getPriceId:()=> 'price_sms',
  })
  const res=fakeRes()
  await handler({method:'POST',headers:{authorization:'Bearer ok'},body:{}},res)
  assert.equal(res.statusCode,200)
  assert.equal(called.id,'sub_1')
  assert.deepEqual(called.params.items,[{id:'si_sms',deleted:true}])
  assert.equal(called.params.proration_behavior,'always_invoice')
})

await check('Remove SMS add-on is idempotency-safe when the SMS item is already absent', async () => {
  let updated=false
  const handler=createSmsAddonRemoveHandler({
    verifyIdToken:async()=>({uid:'u1'}),
    getProfile:async()=>({plan:'plus',subscriptionStatus:'active',stripeCustomerId:'cus_1',stripeSubscriptionId:'sub_1'}),
    retrieveSubscription:async()=>({id:'sub_1',customer:'cus_1',items:{data:[{id:'si_plus',price:{id:'price_1TxaNJGHgBd6ZgJEpAhrWark'}}]}}),
    updateSubscription:async()=>{ updated=true },
    getPriceId:()=> 'price_sms',
  })
  const res=fakeRes()
  await handler({method:'POST',headers:{authorization:'Bearer ok'},body:{}},res)
  assert.equal(res.statusCode,409)
  assert.equal(updated,false)
})
'''
text = text.replace(marker, tests + marker)
test.write_text(text)
