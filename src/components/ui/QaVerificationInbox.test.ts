import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { User } from 'firebase/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import QaVerificationInbox from './QaVerificationInbox'
let tree: ReactTestRenderer
const request = vi.fn(), user = { uid: 'synthetic-user', getIdToken: vi.fn().mockResolvedValue('synthetic-token') } as unknown as User
const message = (code: string) => ({ label: 'Verify test email', url: `http://127.0.0.1:9399/emulator/action?mode=verifyEmail&oobCode=${code}` })
beforeEach(() => { vi.stubEnv('DEV', true); vi.stubEnv('VITE_ACCOUNT_ONBOARDING_QA', '1'); vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-idogs-account-onboarding'); vi.stubGlobal('fetch', request); request.mockReset().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) }) })
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
async function render(value = user) { await act(async () => { tree = create(createElement(QaVerificationInbox, { user: value })) }) }
async function open() { await act(async () => { await tree.root.findByType('button').props.onClick() }) }
it.each(['production-build', 'cloud-project', 'flag-off'])('never exposes a fake inbox outside the isolated local QA: %s', async mode => {
 if (mode === 'production-build') vi.stubEnv('DEV', false)
 if (mode === 'cloud-project') vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'idogs-app-staging')
 if (mode === 'flag-off') vi.stubEnv('VITE_ACCOUNT_ONBOARDING_QA', '0')
 await render(); expect(tree.toJSON()).toBeNull(); expect(request).not.toHaveBeenCalled()
})
it('opens the latest test email inline, without applying any verification code automatically', async () => {
 request.mockResolvedValue({ ok: true, json: async () => ({ messages: [message('OLD_TEST'), message('LATEST_TEST')] }) })
 await render(); await open()
 expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][0]).toBe('/api/qa-onboarding/mailbox')
 expect(tree.root.findAllByType('a')).toHaveLength(1); expect(tree.root.findByType('a').props.href).toBe(message('LATEST_TEST').url)
 expect(JSON.stringify(tree.toJSON())).toContain('no email is sent to Gmail')
})
it('explains how to request a message when the fake mailbox is empty', async () => {
 await render(); await open(); expect(JSON.stringify(tree.toJSON())).toContain('Choose Send verification email above')
})
it('filters external URLs, embedded credentials and password-reset actions from the verification inbox', async () => {
 request.mockResolvedValue({ ok: true, json: async () => ({ messages: [message('VALID_TEST'), { ...message('X'), url: 'https://attacker.invalid/emulator/action?mode=verifyEmail&oobCode=X' }, { ...message('X'), url: 'http://user:password@127.0.0.1:9399/emulator/action?mode=verifyEmail&oobCode=X' }, { ...message('X'), url: 'http://127.0.0.1:9399/emulator/action?mode=resetPassword&oobCode=X' }] }) })
 await render(); await open(); expect(tree.root.findAllByType('a')).toHaveLength(1); expect(tree.root.findByType('a').props.href).toBe(message('VALID_TEST').url)
})
it('shows a useful error without exposing response/provider details', async () => {
 request.mockRejectedValue(new Error('sensitive raw response')); await render(); await open()
 expect(JSON.stringify(tree.toJSON())).not.toContain('sensitive raw response'); expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not open the test inbox')
})
it('does not show the old account mailbox after an account switch', async () => {
 let resolve!: (value: unknown) => void
 request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
 await render(); await act(async () => { tree.root.findByType('button').props.onClick() })
 await act(async () => { tree.update(createElement(QaVerificationInbox, { user: { ...user, uid: 'different-user' } as User })) })
 await act(async () => { resolve({ ok: true, json: async () => ({ messages: [message('OLD_ACCOUNT')] }) }) })
 expect(tree.root.findAllByType('a')).toHaveLength(0)
})
