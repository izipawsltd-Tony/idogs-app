import {describe,it,expect,vi} from 'vitest'
import {createBillingSummaryHandler} from '../api/_lib/billing-handler.js'
describe('Stripe canceled subscriptions override stale Billing display only',()=>{
 it.each(['canceled','incomplete_expired','unpaid'])('shows %s as Free and SMS cancelled without profile writes',async status=>{
  const profile={plan:'plus',subscriptionStatus:'active',smsAddonStatus:'active',stripeCustomerId:'cus_qa',stripeSubscriptionId:'sub_qa'}
  const handler=createBillingSummaryHandler({verifyIdToken:async()=>({uid:'qa'}),getProfile:async()=>profile,retrieveSubscription:async()=>({id:'sub_qa',customer:'cus_qa',status}),listInvoices:async()=>({data:[]})})
  const out={};const res={status:s=>{out.status=s;return res},json:b=>{out.body=b}}
  await handler({method:'GET',headers:{authorization:'Bearer synthetic'}},res)
  expect(out.status).toBe(200)
  expect(out.body.entitlement).toMatchObject({plan:'free',subscriptionStatus:status})
  expect(out.body.sms.status).toBe('cancelled')
  expect(profile.smsAddonStatus).toBe('active')
 })
})
