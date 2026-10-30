import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s=vi.hoisted(()=>({user:{uid:'existing-phone',email:null as string|null,emailVerified:false,providerData:[] as {providerId:string}[]},check:vi.fn(),link:vi.fn(),finish:vi.fn(),request:vi.fn()}))
vi.mock('../hooks/useAuth',()=>({useAuth:()=>({user:s.user,loading:false,checkEmailVerified:s.check})}))
vi.mock('../lib/accountOnboarding',()=>({onboardingQaEnabled:()=>true,linkPrimaryEmail:s.link,finishPrimaryPassword:s.finish,accountSetupRequest:s.request}))
import CompleteAccountPage from './CompleteAccountPage'
let tree:ReactTestRenderer
function Destination(){return createElement('output',{},useLocation().pathname+useLocation().search)}
async function render(){await act(async()=>{tree=create(createElement(MemoryRouter,{initialEntries:['/complete-account?next=%2Fp%2FQR-DEMO%3Ffollow%3D1']},createElement(Routes,null,createElement(Route,{path:'/complete-account',element:createElement(CompleteAccountPage)}),createElement(Route,{path:'*',element:createElement(Destination)}))))})}
beforeEach(()=>{s.user={uid:'existing-phone',email:null,emailVerified:false,providerData:[]};s.check.mockReset().mockResolvedValue(false);s.link.mockReset().mockResolvedValue({sent:true});s.finish.mockReset().mockResolvedValue(undefined);s.request.mockReset().mockResolvedValue({ready:false})})
afterEach(()=>{if(tree)act(()=>tree.unmount())})
it('offers email/password linking without creating a different account',async()=>{
 await render();act(()=>{tree.root.findByProps({type:'email'}).props.onChange({target:{value:'qa@example.invalid'}});tree.root.findByProps({type:'password'}).props.onChange({target:{value:'Synthetic-only-123!'}})})
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 expect(s.link).toHaveBeenCalledWith(s.user,'qa@example.invalid','Synthetic-only-123!');expect(s.finish).not.toHaveBeenCalled()
})
it('retains the current account and original destination after an email conflict',async()=>{
 s.link.mockRejectedValueOnce(new Error('email conflict'));await render()
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 expect(tree.root.findAllByType('output')).toHaveLength(0);expect(JSON.stringify(tree.toJSON())).toContain('accounts have not been merged')
})
it('will not offer management completion until an attached email is verified',async()=>{
 s.user.email='qa@example.invalid';await render()
 expect(tree.root.findAllByType('form')).toHaveLength(0);expect(JSON.stringify(tree.toJSON())).toContain('Check or resend verification email')
 expect(s.finish).not.toHaveBeenCalled()
  expect(tree.root.findAllByType('a').find(a=>a.children.includes('Keep browsing public profiles'))!.props.href).toBe('/p/QR-DEMO')
})
it('returns to the exact public QR/follow destination only after password confirmation',async()=>{
 s.user.email='qa@example.invalid';s.user.emailVerified=true;s.user.providerData=[{providerId:'password'}];s.check.mockResolvedValue(true)
 await render();act(()=>tree.root.findByProps({type:'password'}).props.onChange({target:{value:'Synthetic-only-123!'}}))
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 expect(s.finish).toHaveBeenCalledWith(s.user,'Synthetic-only-123!');expect(tree.root.findByType('output').children.join('')).toBe('/p/QR-DEMO?follow=1')
})
