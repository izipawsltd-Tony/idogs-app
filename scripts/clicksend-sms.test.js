import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendClickSendSms } from '../api/_lib/clicksend-sms.js'
import relay from '../api/send-sms.js'

const env = { CLICKSEND_USERNAME: 'synthetic-user', CLICKSEND_API_KEY: 'synthetic-key' }
const phone = '+61400000000'
const payload = (status = 'SUCCESS') => ({ response_code: 'SUCCESS', data: {
  messages: [{ status, message_id: 'qa-provider-id' }],
} })
const response = data => ({ ok: true, status: 200, json: async () => data })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('ClickSend transport (synthetic; no network)', () => {
  it('sends one message using server Basic auth and an opaque reconciliation reference', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(payload()))
    const result = await sendClickSendSms(phone, 'iDogs QA', { deliveryId: 'opaque-id' }, { env, fetchImpl })
    expect(result).toEqual({ provider: 'clicksend', providerMessageId: 'qa-provider-id', accepted: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://rest.clicksend.com/v3/sms/send')
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('synthetic-user:synthetic-key').toString('base64')}`)
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body)).toEqual({ messages: [{ source: 'idogs', to: phone, body: 'iDogs QA', custom_string: 'opaque-id' }] })
  })
  it.each([{}, { CLICKSEND_USERNAME: 'synthetic-user' }])('fails closed before I/O without complete credentials', async config => {
    const fetchImpl = vi.fn()
    await expect(sendClickSendSms(phone, 'QA', {}, { env: config, fetchImpl })).rejects.toMatchObject({ code: 'SMS_NOT_CONFIGURED', definitive: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['INVALID_RECIPIENT','INSUFFICIENT_CREDIT','ACCOUNT_NOT_ACTIVATED'])('does not mistake HTTP 200 / %s for acceptance', async status => {
    await expect(sendClickSendSms(phone, 'QA', {}, { env, fetchImpl: vi.fn().mockResolvedValue(response(payload(status))) })).rejects.toMatchObject({ code: 'SMS_PROVIDER_REJECTED', definitive: true })
  })
  it.each([{}, { response_code: 'SUCCESS' }, { response_code: 'SUCCESS', data: { messages: [{ status: 'SUCCESS' }] } }, payload('THROTTLED')])('keeps malformed or ambiguous outcomes unresolved', async data => {
    await expect(sendClickSendSms(phone, 'QA', {}, { env, fetchImpl: vi.fn().mockResolvedValue(response(data)) })).rejects.toMatchObject({ code: 'SMS_DELIVERY_UNKNOWN', definitive: false })
  })
  it('does not retry or leak a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('synthetic secret and recipient'))
    await expect(sendClickSendSms(phone, 'QA', {}, { env, fetchImpl })).rejects.toMatchObject({ message: 'SMS_DELIVERY_UNKNOWN', definitive: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('aborts a stalled send once, retaining an ambiguous outcome', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')))))
    const pending = expect(sendClickSendSms(phone, 'QA', {}, { env, fetchImpl })).rejects.toMatchObject({ definitive: false })
    await vi.advanceTimersByTimeAsync(10000)
    await pending
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each([401,403])('treats HTTP %s as a definitive authentication rejection', async status => {
    await expect(sendClickSendSms(phone, 'QA', {}, { env, fetchImpl: vi.fn().mockResolvedValue({ status, ok: false }) })).rejects.toMatchObject({ definitive: true, code: 'SMS_AUTH_REJECTED' })
  })
  it.each([429,500,502])('does not automatically retry HTTP %s', async status => {
    await expect(sendClickSendSms(phone, 'QA', {}, { env, fetchImpl: vi.fn().mockResolvedValue({ status, ok: false }) })).rejects.toMatchObject({ definitive: false })
  })
  it('rejects unauthenticated relay requests before any transport I/O', async () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron')
    const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl)
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await relay({ method: 'POST', headers: {}, body: { phone, message: 'QA' } }, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
