import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s=vi.hoisted(()=>({reset:vi.fn()}))
vi.mock('../hooks/useAuth',()=>({useAuth:()=>({resetPassword:s.reset})}))
vi.mock('../lib/accountOnboarding',()=>({onboardingQaEnabled:()=>true}))
import ForgotPasswordPage from './ForgotPasswordPage'
let tree:ReactTestRenderer
beforeEach(()=>s.reset.mockReset().mockResolvedValue(undefined))
afterEach(()=>{if(tree)act(()=>tree.unmount())})
async function render(next:string){await act(async()=>{tree=create(createElement(MemoryRouter,{initialEntries:['/forgot-password?next='+encodeURIComponent(next)]},createElement(ForgotPasswordPage)))})}
async function submit(){act(()=>tree.root.findByType('input').props.onChange({target:{value:'demo@example.invalid'}}));await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})}
it('keeps the puppy Follow destination through password reset and return to login',async()=>{
 await render('/p/QR-DEMO?follow=1');await submit()
 expect(s.reset).toHaveBeenCalledWith('demo@example.invalid','/p/QR-DEMO?follow=1')
 expect(tree.root.findAllByType('a').some(a=>a.props.href==='/login?next=%2Fp%2FQR-DEMO%3Ffollow%3D1')).toBe(true)
})
it('cannot turn the reset return path into an external redirect',async()=>{
 await render('https://attacker.invalid');await submit()
 expect(s.reset).toHaveBeenCalledWith('demo@example.invalid','/app/dashboard')
 expect(JSON.stringify(tree.toJSON())).not.toContain('attacker.invalid')
})
it('does not reveal whether the email exists while retaining the account return path',async()=>{
 await render('/app/settings');s.reset.mockRejectedValueOnce(new Error('auth/user-not-found'));await submit()
 expect(JSON.stringify(tree.toJSON())).toContain('If this email is registered')
 expect(tree.root.findAllByProps({role:'alert'})).toHaveLength(0)
})
