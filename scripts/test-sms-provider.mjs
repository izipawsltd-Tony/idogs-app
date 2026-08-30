import assert from 'node:assert/strict'
import { getSmsProviderName, smsProviderConfigStatus, sendSmsProvider } from '../api/_lib/sms-provider.js'

let passed = 0
async function check(name, fn) { await fn(); passed++; console.log('PASS', name) }

await check('defaults to AWS SNS for backward-compatible production rollout', () => {
  assert.equal(getSmsProviderName({}), 'aws_sns')
})
await check('ClickSend config requires username and API key', () => {
  assert.deepEqual(smsProviderConfigStatus({ SMS_PROVIDER:'clicksend' }), {provider:'clicksend', configured:false, senderIdConfigured:false})
  assert.equal(smsProviderConfigStatus({SMS_PROVIDER:'clicksend',CLICKSEND_USERNAME:'u',CLICKSEND_API_KEY:'k'}).configured, true)
})
await check('ClickSend request uses Basic auth and AU recipient', async () => {
  let seen
  const result = await sendSmsProvider('+61412345678', 'iDogs test', {
    env:{SMS_PROVIDER:'clicksend',CLICKSEND_USERNAME:'api-user',CLICKSEND_API_KEY:'secret-key',CLICKSEND_SENDER_ID:'iDogs'},
    fetchImpl: async (url, options) => {
      seen={url,options}
      return {ok:true,status:200,json:async()=>({response_code:'SUCCESS',data:{messages:[{message_id:'cs_123',status:'SUCCESS'}]}})}
    },
  })
  assert.equal(seen.url, 'https://rest.clicksend.com/v3/sms/send')
  assert.equal(seen.options.method, 'POST')
  assert.equal(seen.options.headers.Authorization, 'Basic ' + Buffer.from('api-user:secret-key').toString('base64'))
  assert.deepEqual(JSON.parse(seen.options.body), {messages:[{source:'iDogs',body:'iDogs test',to:'+61412345678',from:'iDogs'}]})
  assert.equal(result.MessageId, 'cs_123')
})
await check('ClickSend provider failure throws', async () => {
  await assert.rejects(() => sendSmsProvider('+61412345678', 'test', {
    env:{SMS_PROVIDER:'clicksend',CLICKSEND_USERNAME:'u',CLICKSEND_API_KEY:'k'},
    fetchImpl: async () => ({ok:false,status:401,json:async()=>({response_code:'AUTH_FAILED'})}),
  }), error => error.code === 'CLICKSEND_401')
})
await check('ClickSend success without message id fails closed', async () => {
  await assert.rejects(() => sendSmsProvider('+61412345678', 'test', {
    env:{SMS_PROVIDER:'clicksend',CLICKSEND_USERNAME:'u',CLICKSEND_API_KEY:'k'},
    fetchImpl: async () => ({ok:true,status:200,json:async()=>({response_code:'SUCCESS',data:{messages:[{}]}})}),
  }), error => error.code === 'CLICKSEND_MESSAGE_ID_MISSING')
})
console.log(`\nClickSend SMS provider: ${passed}/${passed} PASS`)
