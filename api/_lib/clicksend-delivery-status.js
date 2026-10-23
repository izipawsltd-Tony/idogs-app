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

const QA_BODY='iDogs QA: test of registered Sender ID iDogs. No action required.'
const QA_DAY_START=Date.parse('2026-10-23T00:00:00Z')/1000
// Recover a possibly accepted SMS when the Firestore QA lock is missing.
// Search strictly by exact synthetic QA body, sender and target day.
// Never disclose recipient, body, API credentials or unrelated history.
export async function findOwnerQaSmsInClickSendHistory({env=process.env,fetchImpl=fetch}={}) {
  if (!env.CLICKSEND_USERNAME || !env.CLICKSEND_API_KEY) return {status:'CONFIG_MISSING'}
  // Bound to the authorized test date: at most three read-only GET pages.
  const start=QA_DAY_START-12*3600
  const end=QA_DAY_START+48*3600
  const matches=[]
  let inspected=0
  let pageCount=0
  try {
    for(let page=1;page<=3;page++){
      const url=BASE+'/sms/history?'+new URLSearchParams({
        date_from:String(start),date_to:String(end),page:String(page),
        limit:'100',order_by:'date:desc',
      })
      const response=await fetchImpl(url,{
        method:'GET',headers:{Authorization:AUTH(env)},signal:AbortSignal.timeout(12000),
      })
      if(!response.ok) return {status:'HISTORY_UNAVAILABLE',
        source:'HISTORY_FALLBACK',httpStatus:response.status===401?401:response.status===403?403:0}
      const result=await response.json()
      if(result?.response_code!=='SUCCESS') return {status:'HISTORY_UNAVAILABLE',source:'HISTORY_FALLBACK'}
      const messages=Array.isArray(result.data?.data)?result.data.data:
        Array.isArray(result.data)?result.data:[]
      pageCount++
      inspected+=messages.length
      for(const x of messages){
        if(x?.from==='iDogs' && x?.body===QA_BODY &&
            Number(x?.date)>=start && Number(x?.date)<=end &&
            (x?.direction==='out' || x?.direction==null)) matches.push(x)
      }
      if(messages.length<100) break
    }
    if(!matches.length) return {status:'NOT_FOUND_IN_RECENT_HISTORY',source:'HISTORY_FALLBACK',
      lockFound:false,historyRecordsInspected:inspected,pagesChecked:pageCount}
    if(matches.length!==1) return {status:'MULTIPLE_QA_MATCHES',source:'HISTORY_FALLBACK',
      lockFound:false,matchCount:matches.length}
    const msg=matches[0]
    const code=String(msg.status_code||'')
    const status=SAFE_STATUS.has(msg.status)?msg.status:'UNKNOWN'
    return {
      status:code==='201'?'DELIVERED':code==='300'||code==='301'?'FAILED':
        status==='Failed'||status==='Cancelled'?'FAILED':'PENDING',
      source:'HISTORY_FALLBACK',lockFound:false,clicksendStatus:status,code,
      messageIdPresent:typeof msg.message_id==='string' && !!msg.message_id,
    }
  } catch {return {status:'CHECK_UNAVAILABLE',source:'HISTORY_FALLBACK',lockFound:false}}
}
