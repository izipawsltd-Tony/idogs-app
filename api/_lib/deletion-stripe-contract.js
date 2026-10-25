// Unwired SDK contract for review and mock-only tests. No credentials, SDK
// construction, HTTP route, scheduler or production enable switch exists here.
// The emulator deletion worker rejects this adapter's non-synthetic mode.
const fail=code=>Object.assign(new Error(code),{code})
const customerId=s=>typeof s.customer==='string'?s.customer:s.customer?.id
const terminal=new Set(['canceled','incomplete_expired'])
const actionable=new Set(['active','trialing','past_due','unpaid','incomplete','paused'])

export function createStripeDeletionRenewalContract({stripe,loadOwnership,assertRuntime,expectedAccountId,expectedLivemode}){
  if(typeof assertRuntime!=='function'||typeof loadOwnership!=='function'||!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId||'')||typeof expectedLivemode!=='boolean')throw fail('STRIPE_DELETION_CONTRACT_CONFIGURATION')
  const discovered=new Map()
  async function target(){
    assertRuntime()
    const account=await stripe.accounts.retrieve()
    if(account.id!==expectedAccountId)throw fail('STRIPE_DELETION_ACCOUNT_MISMATCH')
  }
  async function binding(uid){
    const ownership=await loadOwnership(uid)
    // Server-derived reverse binding, not an email/metadata match or client ID.
    if(!ownership||ownership.ownerUids?.length!==1||ownership.ownerUids[0]!==uid||!/^cus_[A-Za-z0-9]+$/.test(ownership.customerId||'')||!Array.isArray(ownership.knownSubscriptionIds))throw fail('STRIPE_DELETION_OWNERSHIP_UNCONFIRMED')
    return ownership
  }
  function checkSubscription(s,b,expectedId){
    if(!s||!/^sub_[A-Za-z0-9]+$/.test(s.id||'')||(expectedId&&s.id!==expectedId)||customerId(s)!==b.customerId||s.livemode!==expectedLivemode||(!terminal.has(s.status)&&!actionable.has(s.status)))throw fail('STRIPE_DELETION_SUBSCRIPTION_MISMATCH')
  }
  async function all(list,params){
    const result=[],seen=new Set();let cursor
    for(let page=0;page<20;page++){
      assertRuntime()
      const response=await list({...params,limit:100,...(cursor?{starting_after:cursor}:{})})
      if(!Array.isArray(response?.data)||typeof response.has_more!=='boolean')throw fail('STRIPE_DELETION_INVENTORY_INVALID')
      for(const item of response.data){if(!item.id||seen.has(item.id))throw fail('STRIPE_DELETION_PAGINATION_INVALID');seen.add(item.id);result.push(item)}
      if(!response.has_more)return result
      cursor=response.data.at(-1)?.id
      if(!cursor)throw fail('STRIPE_DELETION_PAGINATION_INVALID')
    }
    throw fail('STRIPE_DELETION_INVENTORY_LIMIT')
  }
  return {
    mode:'stripe-contract-unwired',
    async discover(uid){
      for(const [id,scope] of discovered)if(scope.uid===uid)discovered.delete(id)
      await target();const b=await binding(uid)
      const customer=await stripe.customers.retrieve(b.customerId)
      if(customer.id!==b.customerId||customer.deleted||customer.livemode!==expectedLivemode)throw fail('STRIPE_DELETION_CUSTOMER_MISMATCH')
      const subs=await all(params=>stripe.subscriptions.list(params),{customer:b.customerId,status:'all'})
      subs.forEach(s=>checkSubscription(s,b))
      if(b.knownSubscriptionIds.some(id=>!subs.some(s=>s.id===id)))throw fail('STRIPE_DELETION_LINKED_SUBSCRIPTION_MISSING')
      const schedules=await all(params=>stripe.subscriptionSchedules.list(params),{customer:b.customerId})
      if(schedules.some(s=>customerId(s)!==b.customerId||s.livemode!==expectedLivemode||!['released','completed','canceled'].includes(s.status)))throw fail('STRIPE_DELETION_SCHEDULE_REVIEW')
      const sessions=await all(params=>stripe.checkout.sessions.list(params),{customer:b.customerId})
      if(sessions.some(s=>customerId(s)!==b.customerId||s.livemode!==expectedLivemode||s.status==='open'||(s.status==='complete'&&s.payment_status==='unpaid')))throw fail('STRIPE_DELETION_CHECKOUT_REVIEW')
      for(const s of subs)discovered.set(s.id,{uid,customerId:b.customerId})
      return {uid,complete:true,subscriptions:subs.map(s=>({id:s.id,ownerUid:uid}))}
    },
    async stopRenewal(id,{uid,idempotencyKey}){
      await target();const cached=discovered.get(id),b=await binding(uid)
      if(!cached||cached.uid!==uid||cached.customerId!==b.customerId||typeof idempotencyKey!=='string'||!idempotencyKey.startsWith(`deletion/${uid}/`)||!idempotencyKey.endsWith(`/${id}`))throw fail('STRIPE_DELETION_UNDISCOVERED_SUBSCRIPTION')
      const s=await stripe.subscriptions.retrieve(id);checkSubscription(s,b,id)
      if(s.schedule)throw fail('STRIPE_DELETION_SCHEDULE_REVIEW')
      if(!terminal.has(s.status)&&s.cancel_at_period_end!==true){
        assertRuntime()
        await stripe.subscriptions.update(id,{cancel_at_period_end:true},{idempotencyKey})
      }
    },
    async verify(id){
      await target();const cached=discovered.get(id)
      if(!cached)throw fail('STRIPE_DELETION_UNDISCOVERED_SUBSCRIPTION')
      const b=await binding(cached.uid)
      if(b.customerId!==cached.customerId)throw fail('STRIPE_DELETION_OWNERSHIP_CHANGED')
      const s=await stripe.subscriptions.retrieve(id);checkSubscription(s,b,id)
      return {id,ownerUid:cached.uid,renewalStopped:!s.schedule&&(terminal.has(s.status)||s.cancel_at_period_end===true)}
    },
  }
}
