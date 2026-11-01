import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({ user: { uid: 'phone-qa', email: null as string | null, emailVerified: false }, check: vi.fn(), resend: vi.fn(), send: vi.fn(), logout: vi.fn(), toast: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: s.user, loading: false, checkEmailVerified: s.check, resendVerificationEmail: s.resend, logout: s.logout }) }))
vi.mock('../lib/firebase', () => ({ auth: { get currentUser() { return s.user } } }))
vi.mock('../lib/signupVerification', () => ({ verificationDelivery: () => null }))
vi.mock('firebase/auth', () => ({ verifyBeforeUpdateEmail: s.send }))
import VerifyEmailPage from './VerifyEmailPage'
let tree: ReactTestRenderer
function Destination() { const l = useLocation(); return createElement('output', {}, l.pathname + l.search) }
beforeEach(() => { vi.stubGlobal('location', {origin:'https://qa.example.invalid'}); s.user = { uid: 'phone-qa', email: null, emailVerified: false }; s.check.mockReset().mockResolvedValue(false); s.send.mockReset().mockResolvedValue(undefined); s.resend.mockReset().mockResolvedValue(undefined); s.logout.mockReset().mockResolvedValue(undefined); s.toast.mockClear() })
afterEach(() => { if (tree) act(() => tree.unmount());vi.unstubAllGlobals() })
async function render() { await act(async () => { tree = create(createElement(MemoryRouter, { initialEntries: ['/verify-email?next=%2Fapp%2Fshared-dogs%2Fruby'] }, createElement(Routes, {}, createElement(Route, { path: '/verify-email', element: createElement(VerifyEmailPage, { toast: s.toast }) }), createElement(Route, { path: '*', element: createElement(Destination) })))) }) }
function button(label: string) { return tree.root.findAllByType('button').find(b => b.children.includes(label))! }
it('places email before Check and Send, and refuses to treat an entered email as a verified identity', async () => {
 await render()
 const controls=tree.root.findAll(n=>n.type==='input'||n.type==='button')
 expect(controls[0].props.type).toBe('email')
 expect(controls[1].children).toContain("I've verified — continue")
 expect(controls[2].children).toContain('Send verification email')
 act(()=>tree.root.findByType('input').props.onChange({target:{value:'existing@example.invalid'}}))
 await act(async()=>{await button("I've verified — continue").props.onClick()})
 expect(tree.root.findAllByType('output')).toHaveLength(0)
 expect(tree.root.findByProps({role:'alert'}).children.join('')).toContain('sign in to that account instead')
 expect(s.send).not.toHaveBeenCalled()
})
it('continues to the original destination when the signed-in account has actually verified its email', async () => {
 await render()
 s.check.mockImplementationOnce(async()=>{s.user.email='verified@example.invalid';return true})
 await act(async()=>{await button("I've verified — continue").props.onClick()})
 expect(tree.root.findByType('output').children.join('')).toBe('/app/shared-dogs/ruby')
})
it('reports an unverified registered email without entering the next window', async () => {
 s.user.email='unverified@example.invalid'; await render()
 await act(async()=>{await button("I've verified — continue").props.onClick()})
 expect(tree.root.findAllByType('output')).toHaveLength(0)
 expect(tree.root.findByProps({role:'alert'}).children.join('')).toContain('not verified yet')
})
it('validates email spelling/format before sending and keeps failures visible inline', async () => {
 await render();act(()=>tree.root.findByType('input').props.onChange({target:{value:'invalid'}}))
 await act(async()=>{await button('Send verification email').props.onClick()})
 expect(s.send).not.toHaveBeenCalled()
 expect(tree.root.findByProps({role:'alert'}).children.join('')).toContain('valid email')
})
it('offers sign-in again for an expired session and preserves the verification return path', async () => {
 await render();act(()=>tree.root.findByType('input').props.onChange({target:{value:'qa@example.invalid'}}))
 s.send.mockRejectedValueOnce(new Error('auth/requires-recent-login'))
 await act(async()=>{await button('Send verification email').props.onClick()})
 expect(tree.root.findByProps({role:'alert'}).children.join('')).toContain('sign in again')
 await act(async()=>{await button('Sign in again').props.onClick()})
 expect(s.logout).toHaveBeenCalledOnce()
 expect(tree.root.findByType('output').children.join('')).toContain('/login?next=%2Fverify-email%3Fnext%3D')
})
