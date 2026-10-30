import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const s=vi.hoisted(()=>({user:{uid:'existing-primary',email:'qa@example.invalid',emailVerified:true,phoneNumber:null as string|null},verify:vi.fn(),update:vi.fn(),reauth:vi.fn(),linked:vi.fn()}))
vi.mock('../../lib/firebase',()=>({auth:{get currentUser(){return s.user}}}))
vi.mock('firebase/auth',()=>({EmailAuthProvider:{credential:(email:string,password:string)=>({email,password})},PhoneAuthProvider:class{verifyPhoneNumber=s.verify;static credential(id:string,code:string){return {id,code}}},reauthenticateWithCredential:s.reauth,updatePhoneNumber:s.update,RecaptchaVerifier:class{clear(){}}}))
import PhoneSigninSettings from './PhoneSigninSettings'
let tree:ReactTestRenderer
beforeEach(()=>{
 s.user={uid:'existing-primary',email:'qa@example.invalid',emailVerified:true,phoneNumber:null}
 s.verify.mockReset().mockResolvedValue('challenge');s.update.mockReset().mockResolvedValue(undefined);s.reauth.mockReset().mockImplementation(async()=>({user:s.user}));s.linked.mockReset().mockResolvedValue(undefined)
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({phone:true})}))
})
afterEach(()=>{if(tree)act(()=>tree.unmount());vi.unstubAllGlobals()})
async function render(){await act(async()=>{tree=create(createElement(MemoryRouter,null,createElement(PhoneSigninSettings,{user:s.user as User,profileReady:true,onLinked:s.linked})),{createNodeMock:()=>({})})})}
async function start(){await act(async()=>{tree.root.findAllByType('button').find(b=>b.children.includes(s.user.phoneNumber?'Change mobile number':'Link mobile number'))!.props.onClick()})}
async function send(){act(()=>{tree.root.findByProps({type:'tel'}).props.onChange({target:{value:'0412345678'}});tree.root.findByProps({type:'password'}).props.onChange({target:{value:'synthetic-password'}})});await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})}
async function confirm(){act(()=>tree.root.findByProps({autoComplete:'one-time-code'}).props.onChange({target:{value:'123456'}}));await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})}
it('links the verified phone to the existing identity without creating or switching an account',async()=>{
 await render();await start();await send()
 expect(s.reauth).toHaveBeenCalledWith(s.user,{email:s.user.email,password:'synthetic-password'})
 expect(s.verify).toHaveBeenCalledWith('+61412345678',expect.any(Object));expect(s.linked).not.toHaveBeenCalled()
 await confirm()
 expect(s.update).toHaveBeenCalledWith(s.user,{id:'challenge',code:'123456'});expect(s.linked).toHaveBeenCalledOnce()
 expect(JSON.stringify(tree.toJSON())).toContain('Linked mobile:')
})
it('reports a number already assigned to another account without merging or transferring data',async()=>{
 await render();await start();await send();s.update.mockRejectedValueOnce(new Error('auth/credential-already-in-use'))
 await confirm()
 expect(s.linked).not.toHaveBeenCalled();expect(tree.root.findByProps({role:'alert'}).children.join('')).toContain('no accounts or dog records have been merged')
})
it('requires email verification and does not send a code for an unverified account',async()=>{
 s.user.emailVerified=false;await render()
 expect(tree.root.findAllByType('form')).toHaveLength(0);expect(s.verify).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
})
it('recognises an already linked primary number and does not request another code',async()=>{
 s.user.phoneNumber='+61412345678';await render()
 expect(tree.root.findAllByType('form')).toHaveLength(0);expect(s.verify).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('+61412345678')
})
it('changes a linked number only after password and new-number verification, retaining the same UID',async()=>{
 s.user.phoneNumber='+61499999999';await render();await start();await send()
 expect(s.update).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('+61499999999')
 await confirm();expect(s.update.mock.calls[0][0].uid).toBe('existing-primary');expect(JSON.stringify(tree.toJSON())).toContain('+61412345678')
})
it('does not send an SMS when the email password is wrong',async()=>{
 await render();await start();s.reauth.mockRejectedValueOnce(new Error('auth/invalid-credential'));await send()
 expect(s.verify).not.toHaveBeenCalled();expect(s.update).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('password could not be confirmed')
})
it('rejects an account switch during reauthentication before sending SMS',async()=>{
 await render();await start();s.reauth.mockResolvedValueOnce({user:{uid:'other'}});await send()
 expect(s.verify).not.toHaveBeenCalled();expect(s.update).not.toHaveBeenCalled()
})
it('retains the old number on invalid code and allows a retry',async()=>{
 s.user.phoneNumber='+61499999999';await render();await start();await send();s.update.mockRejectedValueOnce(new Error('auth/invalid-verification-code'));await confirm()
 expect(s.linked).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('+61499999999')
 await confirm();expect(s.linked).toHaveBeenCalledOnce()
})
it('expires a pending replacement without changing the old number',async()=>{
 s.user.phoneNumber='+61499999999';await render();await start();await send();const now=Date.now();const spy=vi.spyOn(Date,'now').mockReturnValue(now+301000)
 try{await confirm();expect(s.update).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('code has expired')}finally{spy.mockRestore()}
})
