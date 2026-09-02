// api/super-admin/ai-ceo.js — authenticated AI CEO OS route
//
// V1.2 keeps the public Super Admin route thin. Authentication remains the
// existing fail-closed Super Admin guard; business aggregation lives in
// api/_lib/ai-ceo-v12.js so the reality/decision kernel is isolated and easy
// to review or roll back. The kernel is read-only: Firestore/Auth/Stripe reads
// only, with no model-provider call and no production-side mutation.
import { verifySuperAdmin } from './_auth.js'
import { buildAiCeoV12 } from '../_lib/ai-ceo-v12.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const actor = await verifySuperAdmin(req, res)
  if (!actor) return

  try {
    const payload = await buildAiCeoV12()
    return res.status(200).json(payload)
  } catch (error) {
    console.error('AI CEO OS v1.2 aggregation error:', error)
    return res.status(500).json({
      error: 'Failed to compile AI CEO operating brief',
      message: error instanceof Error ? error.message : 'Unknown aggregation error',
    })
  }
}
