// Internal-only, read-only ClickSend account verification. No SMS, no PII.
import { checkCronAuth } from './_lib/cron-auth.js'
import { verifyClickSendAccount } from './_lib/clicksend-health.js'
export default async function handler(req,res) {
  const auth=checkCronAuth(req)
  if(!auth.authorized) return res.status(auth.status).json(auth.body)
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'})
  const outcome=await verifyClickSendAccount()
  res.setHeader('Cache-Control','no-store')
  return res.status(outcome.ok?200:503).json(outcome)
}
