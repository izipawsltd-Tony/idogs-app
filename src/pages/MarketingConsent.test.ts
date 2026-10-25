import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({profile:{} as any,update:vi.fn(),refresh:vi.fn(),read:vi.fn()}))
vi.mock('../hooks/useAuth',()=>({useAuth:()=>({user:{uid:'qa',email:'qa@example.invalid'},profile:state.profile,refreshProfile:state.refresh})}))
vi.mock('../lib/db',()=>({updateUserProfile:state.update}))
vi.mock('../lib/firebase',()=>({db:{}}))
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,collection:string,id:string)=>({collection,id}),getDocFromServer:state.read}))
import SettingsPage from './SettingsPage'
const label='iDogs news and promotional offers'
beforeEach(()=>{
 state.profile={role:'owner',emailReminders:false,manualReminderEmails:false}
 state.refresh.mockReset().mockResolvedValue(undefined)
 state.read.mockReset()
 state.update.mockReset().mockImplementation(async(_uid,data)=>{
  state.read.mockResolvedValue({exists:()=>true,data:()=>data})
 })
})
function page(){const toast=vi.fn();const view=create(createElement(MemoryRouter,null,createElement(SettingsPage,{toast})));return {toast,view,toggle:()=>view.root.findByProps({'aria-label':label})}}
describe('marketing consent settings',()=>{
 it('keeps legacy accounts off independently of email and SMS preferences',()=>{
  const {toggle}=page();expect(toggle().props['aria-checked']).toBe(false)
  expect(state.update).not.toHaveBeenCalled()
 })
 it('saves explicit opt-in for this email and confirms server persistence before success',async()=>{
  const {toggle,toast}=page();await act(async()=>{await toggle().props.onClick()})
  expect(state.update).toHaveBeenCalledWith('qa',{marketingConsent:expect.objectContaining({choice:'opt_in',channel:'email_marketing',source:'account_settings',checkboxDefault:false,revokedAt:null,email:'qa@example.invalid',optedInAt:expect.any(String)})})
  expect(Object.keys(state.update.mock.calls[0][1])).toEqual(['marketingConsent'])
  expect(state.read).toHaveBeenCalledWith({collection:'users',id:'qa'})
  expect(state.refresh).toHaveBeenCalledWith(true)
  expect(toast).toHaveBeenCalledWith('Marketing email preference saved','success')
 })
 it('records revocation while preserving the original opt-in date',async()=>{
  state.profile.marketingConsent={channel:'email_marketing',choice:'opt_in',email:'qa@example.invalid',optedInAt:'2026-10-01T00:00:00Z',revokedAt:null}
  const {toggle,toast}=page();expect(toggle().props['aria-checked']).toBe(true)
  await act(async()=>{await toggle().props.onClick()})
  expect(state.update.mock.calls[0][1].marketingConsent).toMatchObject({choice:'opt_out',optedInAt:'2026-10-01T00:00:00Z',revokedAt:expect.any(String),evidenceRef:'settings-opt-out-v1'})
  expect(toast).toHaveBeenCalledWith('Marketing emails disabled','success')
 })
 it.each(['other@example.invalid',null])('does not reuse opt-in for a different or missing email: %s',email=>{
  state.profile.marketingConsent={channel:'email_marketing',choice:'opt_in',email}
  expect(page().toggle().props['aria-checked']).toBe(false)
 })
 it.each(['mismatch','offline','wrong-email'])('reports %s server confirmation honestly',async mode=>{
  state.update.mockImplementation(async()=>{
   if(mode==='offline')state.read.mockRejectedValue(new Error('offline'))
   else state.read.mockResolvedValue({exists:()=>true,data:()=>({marketingConsent:{choice:mode==='mismatch'?'opt_out':'opt_in',source:'account_settings',channel:'email_marketing',email:mode==='wrong-email'?'other@example.invalid':'qa@example.invalid',evidenceRef:'settings-opt-in-v1',revokedAt:null}})})
  })
  const {toggle,toast}=page();await act(async()=>{await toggle().props.onClick()})
  expect(toast).toHaveBeenCalledWith('Could not save marketing preference. Please try again.','error')
  expect(state.refresh).not.toHaveBeenCalled()
 })
 it('never reports successful consent when the write is denied',async()=>{
  state.update.mockRejectedValueOnce(new Error('permission-denied'))
  const {toggle,toast}=page();await act(async()=>{await toggle().props.onClick()})
  expect(state.read).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('Could not save marketing preference. Please try again.','error')
 })
})
