import Stripe from 'stripe'
import { requireDeletionEmulators, validAccountId } from './deletion-fence.js'
import { digest } from './deletion-plan.js'

const ensure=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:423})}
const providerId=(v,prefix)=>typeof v==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`).test(v)

// This private client can reach ONLY one explicit loopback fixture. It never
// reads real API keys, exposes a Stripe instance or contacts Stripe's network.
export function createEmulatorLoopbackStripeTransport({db,auth,bucket,projectId,origin,fixture,assertBeforeMutation,executionEnabled=false}){
  ensure(executionEnabled===true,'WEBHOOK_TRANSPORT_DISABLED')
  const runtime=()=>requireDeletionEmulators({db,auth,bucket,projectId})
  runtime()
  const scope={uid:fixture?.uid,nonce:fixture?.nonce,customerId:fixture?.customerId,subscriptionIds:Array.isArray(fixture?.subscriptionIds)?[...fixture.subscriptionIds]:[]}
  ensure(validAccountId(scope.uid)&&scope.uid.startsWith('synthetic-')&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(scope.nonce||'')
    &&providerId(scope.customerId,'cus')&&scope.customerId.startsWith('cus_synthetic_')&&scope.subscriptionIds.length>0&&scope.subscriptionIds.length<=5
    &&scope.subscriptionIds.every(id=>providerId(id,'sub')&&id.startsWith('sub_synthetic_'))&&new Set(scope.subscriptionIds).size===scope.subscriptionIds.length,'WEBHOOK_TRANSPORT_FIXTURE_REQUIRED')
  const endpoint=new URL(origin)
  ensure(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&Number(endpoint.port)>=1024&&Number(endpoint.port)<=65535
    &&endpoint.origin===origin&&!endpoint.username&&!endpoint.password&&endpoint.pathname==='/'&&!endpoint.search&&!endpoint.hash,'WEBHOOK_LOOPBACK_ENDPOINT_REQUIRED')
  const allowed=new Set(scope.subscriptionIds),credential=`synthetic-loopback-${scope.nonce}`
  const nodeClient=Stripe.createNodeHttpClient()
  let client
  function pinned(){
    runtime();ensure(client.getMaxNetworkRetries()===0&&client.getApiField('host')==='127.0.0.1'&&client.getApiField('protocol')==='http'
      &&Number(client.getApiField('port'))===Number(endpoint.port)&&client.getApiField('timeout')===5000,'WEBHOOK_TRANSPORT_SETTINGS_CHANGED')
  }
  const httpClient={getClientName:()=> 'guarded-emulator-loopback',makeRequest:async(host,port,path,method,headers,body,protocol,timeout)=>{
    pinned()
    const request=new URL(path,endpoint.origin),id=request.pathname.match(/^\/v1\/subscriptions\/(sub_[A-Za-z0-9_]+)$/)?.[1]
    ensure(host==='127.0.0.1'&&Number(port)===Number(endpoint.port)&&protocol==='http'&&request.origin===endpoint.origin
      &&allowed.has(id)&&['GET','DELETE'].includes(method)&&timeout>0&&timeout<=5000,'WEBHOOK_TRANSPORT_REQUEST_REJECTED')
    const normalized=Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value]))
    ensure(normalized.authorization===`Bearer ${credential}`&&!normalized['stripe-account']&&!normalized['stripe-context'],'WEBHOOK_TRANSPORT_CONTEXT_CHANGED')
    for(const [key,value] of request.searchParams)ensure(
      method==='GET'&&/^expand(?:\[\d*\])$/.test(key)&&['items.data.price','latest_invoice'].includes(value)
      ||method==='DELETE'&&['prorate','invoice_now'].includes(key)&&value==='false','WEBHOOK_TRANSPORT_QUERY_REJECTED')
    if(method==='DELETE')ensure(!body,'WEBHOOK_TRANSPORT_BODY_REJECTED')
    if(method==='DELETE'){
      ensure(typeof assertBeforeMutation==='function','WEBHOOK_TRANSPORT_EXECUTION_GUARD_REQUIRED')
      await assertBeforeMutation(id)
      pinned()
    }
    return nodeClient.makeRequest(host,port,path,method,headers,body,protocol,timeout)
  }}
  client=new Stripe(credential,{host:'127.0.0.1',port:Number(endpoint.port),protocol:'http',timeout:5000,maxNetworkRetries:0,telemetry:false,httpClient})
  pinned()
  function subscription(value,id){
    ensure(value?.id===id&&value.livemode===false&&(typeof value.customer==='string'?value.customer:value.customer?.id)===scope.customerId
      &&value.metadata?.userId===scope.uid&&value.metadata?.deletionQaNonce===scope.nonce,'WEBHOOK_TRANSPORT_RESPONSE_BINDING_CHANGED')
    return value
  }
  const retrieve=async id=>{
    pinned();ensure(allowed.has(id),'WEBHOOK_TRANSPORT_FOREIGN_SUBSCRIPTION')
    return subscription(await client.subscriptions.retrieve(id,{expand:['items.data.price','latest_invoice']},{maxNetworkRetries:0,timeout:5000}),id)
  }
  return Object.freeze({mode:'emulator-loopback',bindingHash:digest({...scope,origin}),getSubscription:retrieve,cancelSubscription:async(id,params={})=>{
    pinned();ensure(allowed.has(id)&&params&&typeof params==='object'&&!Array.isArray(params),'WEBHOOK_TRANSPORT_CANCEL_SCOPE_REQUIRED')
    const body=structuredClone(params)
    ensure(Object.entries(body).every(([key,value])=>['prorate','invoice_now'].includes(key)&&value===false),'WEBHOOK_TRANSPORT_CANCEL_SCOPE_REQUIRED')
    ensure(typeof assertBeforeMutation==='function','WEBHOOK_TRANSPORT_EXECUTION_GUARD_REQUIRED')
    await retrieve(id);await assertBeforeMutation(id);pinned()
    return subscription(await client.subscriptions.cancel(id,body,{maxNetworkRetries:0,timeout:5000}),id)
  }})
}