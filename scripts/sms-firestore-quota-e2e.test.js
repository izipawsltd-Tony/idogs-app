import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
const api=readFileSync(new URL('../api/qa-sms-quota-firestore.js',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/pages/SettingsPage.tsx',import.meta.url),'utf8')
describe('SMS quota E2E safety contract',()=>{
 it('authenticates a verified staging QA user and requires preview environment',()=>{
  expect(api).toContain("process.env.VERCEL_ENV!=='preview'")
  expect(api).toContain("getAuth().verifyIdToken(raw.slice(7),true)")
  expect(api).toContain("auth.email_verified!==true")
 })
 it('uses only dedicated isolated Firestore collections',()=>{
  expect(api).toContain("'qaSmsQuotaUsers'")
  expect(api).toContain("'qaSmsQuotaDeliveries'")
  expect(api).toContain("'qaSmsQuotaRuns'")
  expect(api).toContain("if(!alias) throw Error('COLLECTION_NOT_ALLOWED')")
 })
 it('cannot contact ClickSend, and prevents re-running the one shot',()=>{
  expect(api).not.toContain('sendClickSendSms')
  expect(api).not.toContain('rest.clicksend.com')
  expect(api).toContain("await runRef.create(")
  expect(api).toContain("error:'E2E_ALREADY_ATTEMPTED'")
  expect(api).toContain("provider=async()=>{calls++;return {MessageId:'synthetic-no-clicksend-request'}}")
 })
 it('checks real quota debit, duplicate, exhausted and delivery records',()=>{
  expect(api).toContain('first=await sendSmsWithQuota(context)')
  expect(api).toContain('duplicate=await sendSmsWithQuota(context)')
  expect(api).toContain("duplicate.reason==='DUPLICATE'")
  expect(api).toContain("exhausted.reason==='SMS_QUOTA_EXHAUSTED'")
  expect(api).toContain("delivery.data()?.status==='sent'")
  expect(ui).toContain('Read quota QA result')
 })
})
