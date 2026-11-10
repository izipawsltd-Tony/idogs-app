// api/super-admin/ai-ceo.js — authenticated AI CEO OS route
//
// V1.2 keeps the public Super Admin route thin. Authentication remains the
// existing fail-closed Super Admin guard; business aggregation lives in
// api/_lib/ai-ceo-v12.js so the reality/decision kernel is isolated and easy
// to review or roll back. The kernel is read-only: Firestore/Auth/Stripe reads
// only, with no model-provider call and no production-side mutation.
import { verifySuperAdmin } from './_auth.js'
import { getControlCenterBrief } from '../_lib/control-center-runtime.js'
import { createControlCenterHandler } from '../_lib/control-center-handler.js'

export default createControlCenterHandler({ verifySuperAdmin, buildBrief: getControlCenterBrief })
