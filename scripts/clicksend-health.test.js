import { describe, it, expect, vi } from 'vitest'
import { verifyClickSendAccount } from '../api/_lib/clicksend-health.js'
const env = { CLICKSEND_USERNAME:'synthetic', CLICKSEND_API_KEY:'synthetic' }
describe('ClickSend read-only healthcheck',()=>{
 it('never calls provider without credentials',async()=>{const fn=vi.fn();expect((await verifyClickSendAccount({env:{},fetchImpl:fn})).ok).toBe(false);expect(fn).not.toHaveBeenCalled()})
 it('GETs account only and never sends SMS',async()=>{const fn=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({response_code:'SUCCESS'})});expect((await verifyClickSendAccount({env,fetchImpl:fn})).ok).toBe(true);expect(fn).toHaveBeenCalledTimes(1);const [url,opt]=fn.mock.calls[0];expect(url).toBe('https://rest.clicksend.com/v3/account');expect(opt.method).toBe('GET');expect(opt.body).toBeUndefined()})
 it('sanitizes authentication failures',async()=>{const fn=vi.fn().mockResolvedValue({ok:false,status:401});expect(await verifyClickSendAccount({env,fetchImpl:fn})).toEqual({ok:false,reason:'CLICKSEND_AUTH_DENIED'})})
 it('sanitizes network failures',async()=>{const fn=vi.fn().mockRejectedValue(new Error('synthetic private error'));expect(await verifyClickSendAccount({env,fetchImpl:fn})).toEqual({ok:false,reason:'CLICKSEND_NETWORK_ERROR'})})
})
