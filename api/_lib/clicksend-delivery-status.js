// Read-only delivery reconciliation. Never send/retry SMS or expose recipient/body.
const BASE='https://rest.clicksend.com/v3'
const AUTH=(env)=>'Basic '+Buffer.from(env.CLICKSEND_USERNAME+':'+env.CLICKSEND_API_KEY).toString('base64')
const SAFE_STATUS=new Set(['Queued','Completed','Scheduled','WaitApproval','Failed','Cancelled','CancelledAfterReview','Received','Sent'])
export async function getClickSendDeliveryStatus(messageId, {env=process.env,fetchImpl=fetch}={}) {
  if (!env.CLICKSEND_USERNAME || !env.CLICKSEND_API_KEY) return {status:'CONFIG_MISSING'}
  if (typeof messageId!=='string' || !/^[a-zA-Z0-9-]{8,128}$/.test(messageId)) return {status:'INVALID_MESSAGE_ID'}
  const headers={Authorization:AUTH(env)}
  try {
    // Delivery receipts may require a POLL rule on the ClickSend account.
    const receipt=await fetchImpl(BASE+'/sms/receipts/'+encodeURIComponent(messageId),{
      method:'GET',headers,signal:AbortSignal.timeout(12000),
    })
    if(receipt.ok){
      const json=await receipt.json()
      if(json?.response_code==='SUCCESS' && json?.data?.message_id===messageId) {
        const code=String(json.data?.status_code||'')
        return {status:code==='201'?'DELIVERED':code==='300'||code==='301'?'FAILED':'PENDING',
          source:'RECEIPT', code}
      }
    }
    // History is read-only and works even without a POLL receipt rule.
    const history=await fetchImpl(BASE+'/sms/history?limit=50&order_by=date:desc',{
      method:'GET',headers,signal:AbortSignal.timeout(12000),
    })
    if(!history.ok) return {status:'HISTORY_UNAVAILABLE'}
    const result=await history.json()
    if(result?.response_code!=='SUCCESS') return {status:'HISTORY_UNAVAILABLE'}
    const list=Array.isArray(result.data?.data)?result.data.data:
      Array.isArray(result.data)?result.data:[]
    const msg=list.find(item=>item.message_id===messageId)
    if(!msg) return {status:'NOT_FOUND_IN_RECENT_HISTORY'}
    const code=String(msg.status_code||'')
    const status=SAFE_STATUS.has(msg.status)?msg.status:'UNKNOWN'
    return {status:code==='201'?'DELIVERED':code==='300'||code==='301'?'FAILED':
      status==='Failed'||status==='Cancelled'?'FAILED':'PENDING', source:'HISTORY',
      clicksendStatus:status, code, senderMatch:msg.from==='iDogs'}
  } catch {return {status:'CHECK_UNAVAILABLE'}}
}
