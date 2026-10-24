// Persisted emulator fixture, not a live provider implementation. The processor
// independently requires all three local emulators before using this adapter.
export function syntheticDeletionProvider(db) {
  const ref = uid => db.collection('deletionSyntheticProviders').doc(uid)
  return {
    mode:'synthetic',
    async discover(uid) {
      const s=await ref(uid).get(),d=s.data()
      return {uid,complete:d?.discoveryComplete===true,subscriptions:d?.subscriptions||[]}
    },
    async stopRenewal(id,{uid,idempotencyKey}) {
      await db.runTransaction(async tx=>{
        const r=ref(uid),s=await tx.get(r),d=s.data()
        if(!d||d.failCancellation)throw new Error('SYNTHETIC_PROVIDER_FAILURE')
        const subscriptions=d.subscriptions.map(item=>item.id===id&&item.ownerUid===uid?{...item,renewalStopped:true}:item)
        if(!subscriptions.some(item=>item.id===id&&item.ownerUid===uid))throw new Error('SYNTHETIC_SUBSCRIPTION_MISMATCH')
        const keys=[...new Set([...(d.keys||[]),idempotencyKey])]
        tx.update(r,{subscriptions,keys})
      })
    },
    async verify(id) {
      const all=await db.collection('deletionSyntheticProviders').get()
      const matches=all.docs.flatMap(s=>(s.data().subscriptions||[]).filter(item=>item.id===id))
      return matches.length===1?matches[0]:null
    },
    async retention(uid) {const d=(await ref(uid).get()).data();return {uid,...d?.retention}},
    async confirm(uid,{idempotencyKey}) {
      await db.runTransaction(async tx=>{
        const r=ref(uid),s=await tx.get(r),d=s.data()
        if(!d||d.failConfirmation)throw new Error('SYNTHETIC_CONFIRMATION_FAILURE')
        tx.update(r,{confirmationKey:idempotencyKey,confirmationAccepted:true})
      })
      return {uid,accepted:true,mode:'synthetic'}
    },
  }
}
