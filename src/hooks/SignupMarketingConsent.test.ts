import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({create:vi.fn(),profile:vi.fn(),verifyEmail:vi.fn(),api:null as any}))
vi.mock('../lib/firebase',()=>({auth:{}}))
vi.mock('firebase/auth',()=>({
 createUserWithEmailAndPassword:state.create,onAuthStateChanged:()=>()=>{},
 signInWithEmailAndPassword:vi.fn(),signOut:vi.fn(),sendPasswordResetEmail:vi.fn(),sendEmailVerification:state.verifyEmail,reload:vi.fn(),updateProfile:vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/db',()=>({createUserProfile:state.profile,getUserProfile:vi.fn().mockResolvedValue(null),getUserProfileFromServer:vi.fn(),updateUserProfile:vi.fn(),deleteUserData:vi.fn()}))
import {AuthProvider,useAuth} from './useAuth'
function Capture(){state.api=useAuth();return null}
beforeEach(async()=>{
 state.create.mockReset().mockResolvedValue({user:{uid:'synthetic',email:'qa@example.invalid',delete:vi.fn()}})
 state.verifyEmail.mockClear()
 state.profile.mockReset().mockResolvedValue(undefined)
 await act(async()=>{create(createElement(AuthProvider,null,createElement(Capture)))})
})
describe('signup consent evidence',()=>{
 it('records explicit Terms acceptance separately from an optional promotion refusal',async()=>{
  await act(async()=>{await state.api.signup({email:'qa@example.invalid',password:'synthetic-only',firstName:'QA',lastName:'',kennelName:'',termsAccepted:true,marketingOptIn:false})})
  expect(state.profile.mock.calls[0][1].termsAcceptance).toMatchObject({version:'terms-2026-10-29',source:'signup',acceptedAt:expect.any(String)})
  expect(state.profile.mock.calls[0][1].marketingConsent.choice).toBe('opt_out')
  expect(state.verifyEmail).not.toHaveBeenCalled()
 })
 it.each([false,true])('stores phone promotion choice separately from email and dog-care SMS: %s',async marketing=>{
  await act(async()=>{await state.api.finishQuickSignIn({uid:'phone',email:null,phoneNumber:'+16505553434',displayName:'Ruby'},true,'Ruby',marketing,true)})
  const profile=state.profile.mock.calls[0][1]
  expect(profile.smsMarketingConsent).toMatchObject({channel:'sms_marketing',choice:marketing?'opt_in':'opt_out',phone:'+16505553434',source:'signup'})
  expect(profile.marketingConsent.choice).toBe('opt_out')
  expect(profile.termsAcceptance.version).toBe('terms-2026-10-29')
  expect(profile).not.toHaveProperty('smsConsent')
 })
 it.each([undefined,false,true])('only explicit checkbox opt-in grants marketing consent: %s',async marketingOptIn=>{
  await act(async()=>{await state.api.signup({email:'qa@example.invalid',password:'synthetic-only',firstName:'QA',lastName:'User',kennelName:'QA',marketingOptIn})})
  expect(state.verifyEmail).not.toHaveBeenCalled()
  expect(state.profile.mock.calls[0][1].role).toBe('owner')
  const consent=state.profile.mock.calls[0][1].marketingConsent
  expect(consent).toMatchObject({choice:marketingOptIn?'opt_in':'opt_out',source:'explicit_checkbox',checkboxDefault:false,channel:'email_marketing',revokedAt:null,email:'qa@example.invalid',evidenceRef:'signup-checkbox-v1'})
  expect(consent.optedInAt).toEqual(marketingOptIn?expect.any(String):null)
 })
})
