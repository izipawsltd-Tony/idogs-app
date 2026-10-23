import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
const endpoint=readFileSync(new URL('../api/qa-clicksend-live-20261024.js',import.meta.url),'utf8')
const old=readFileSync(new URL('../api/qa-clicksend-one-shot.js',import.meta.url),'utf8')
describe('explicit owner-approved live SMS QA is isolated',()=>{
 it('historical test is closed, new QA uses distinct immutable lock',()=>{
  expect(old).toContain('QA_ONE_SHOT_CLOSED')
  expect(endpoint).toContain("const DOC = 'owner-approved-20261024-live-clicksend'")
 })
 it('one send is protected by authenticated verified QA and staging guard',()=>{
  expect(endpoint).toContain("process.env.VERCEL_ENV === 'preview'")
  expect(endpoint).toContain("decoded.email_verified!==true")
  expect(endpoint).toContain("getAuth().verifyIdToken(bearer.slice(7),true)")
  expect(endpoint).toContain('await ref.create(')
  expect(endpoint).toContain('ONE_SHOT_ALREADY_ATTEMPTED')
 })
 it('does not permit caller-supplied SMS destination or content',()=>{
  expect(endpoint).toContain('process.env.SMS_LIVE_QA_RECIPIENT')
  expect(endpoint).toContain("const MESSAGE = 'iDogs QA 24 Oct:")
  expect(endpoint).not.toContain('req.body')
 })
 it('reports accepted provider Message ID separately from delivered state',()=>{
  expect(endpoint).toContain("phase:'PROVIDER_QUEUED_NOT_DELIVERED'")
  expect(endpoint).toContain('providerMessageId:accepted.MessageId')
  expect(endpoint).toContain("delivery:delivery.status")
 })
})
