import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from './_auth.js'
import { getControlCenterBrief } from '../_lib/control-center-runtime.js'
import { createAiBudget, assertAssistantDatabase } from '../_lib/control-center-ai-budget.js'
import { createAssistantHandler, createAssistantProvider } from '../_lib/control-center-assistant.js'

const provider = createAssistantProvider()
// Lazy database access: existing Super Admin guard initializes the Admin SDK.
function runtimeBudget() {
  const db = getFirestore()
  assertAssistantDatabase(process.env.VERCEL_ENV, db.projectId)
  return createAiBudget(db)
}
const budget = {
  reserve: uid => runtimeBudget().reserve(uid),
  finish: (ticket, outcome) => runtimeBudget().finish(ticket, outcome),
}
export const config = { maxDuration: 60 }
export default createAssistantHandler({ verifySuperAdmin, buildBrief: getControlCenterBrief, provider, budget })
