import { getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from './_auth.js'
import { getControlCenterBrief } from '../_lib/control-center-runtime.js'
import { createAiBudget } from '../_lib/control-center-ai-budget.js'
import { createAssistantHandler, createAssistantProvider } from '../_lib/control-center-assistant.js'

const provider = createAssistantProvider()
// Lazy database access: existing Super Admin guard initializes the Admin SDK.
const budget = {
  reserve: uid => createAiBudget(getFirestore()).reserve(uid),
  finish: (ticket, outcome) => createAiBudget(getFirestore()).finish(ticket, outcome),
}
export const config = { maxDuration: 60 }
export default createAssistantHandler({ verifySuperAdmin, buildBrief: getControlCenterBrief, provider, budget })
