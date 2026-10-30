import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const s=vi.hoisted(()=>({user:{uid:'existing-primary',email:'qa@example.invalid',emailVerified:true,phoneNumber:null as string|null},link:vi.fn(),confirm:vi.fn(),linked:vi.fn()}))
vi.mock('../../lib/firebase',()=>({auth:{get currentUser(){return s.user}}}))
vi.mock('firebase/auth',()=>({linkWithPhoneNumber:s.link,RecaptchaVerifier:class{clear(){}}}))
import PhoneSigninSettings from './PhoneSigninSettings'
let tree:ReactTestRenderer
beforeEach(()=>{
 s.user={uid:'existing-primary',email:'qa@example.invalid',emailVerified:true,phoneNumber:null}
 s.link.mockReset().mockResolvedValue({confirm:s.confirm});s.confirm.mockReset().mockImplementation(async()=>({user:{...s.user,phoneNumber:'+61412345678'}}));s.linked.mockReset().mockResolvedValue(undefined)
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({phone:true})}))
})
afterEach(()=>{if(tree)act(()=>tree.unmount());vi.unstubAllGlobals()})
async function render(){await act(async()=>{tree=create(createElement(MemoryRouter,null,createElement(PhoneSigninSettings,{user:s.user as User,profileReady:true,onLinked:s.linked})),{createNodeMock:()=>({})})})}
async function send(){act(()=>tree.root.findByProps({type:'tel'}).props.onChange({target:{value:'0412345678'}}));await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})}
it('links the verified phone to the existing identity without creating or switching an account',async()=>{
 await render();await send()
 expect(s.link).toHaveBeenCalledWith(s.user,'+61412345678',expect.any(Object));expect(s.linked).not.toHaveBeenCalled()
 act(()=>tree.root.findByProps({autoComplete:'one-time-code'}).props.onChange({target:{value:'123456'}}))
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 expect(s.confirm).toHaveBeenCalledWith('123456');expect(s.linked).toHaveBeenCalledOnce()
 expect(JSON.stringify(tree.toJSON())).toContain('SMS sign-in is linked to')
})
it('reports a number already assigned to another account without merging or transferring data',async()=>{
 await render();await send();s.confirm.mockRejectedValueOnce(new Error('auth/credential-already-in-use'))
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 expect(s.linked).not.toHaveBeenCalled();expect(tree.root.findByProps({role:'alert'}).children.join('')).toContain('no accounts or dog records have been merged')
})
it('requires email verification and does not send a code for an unverified account',async()=>{
 s.user.emailVerified=false;await render()
 expect(tree.root.findAllByType('form')).toHaveLength(0);expect(s.link).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
})
it('recognises an already linked primary number and does not request another code',async()=>{
 s.user.phoneNumber='+61412345678';await render()
 expect(tree.root.findAllByType('form')).toHaveLength(0);expect(s.link).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('+61412345678')
})
