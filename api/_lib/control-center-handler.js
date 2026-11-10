import { buildControlCenterEvidence } from './control-center-evidence.js'

// Dependency injection keeps auth/data access testable without credentials.
export function createControlCenterHandler({ verifySuperAdmin, buildBrief }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Vary', 'Authorization')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const actor = await verifySuperAdmin(req, res)
    if (!actor) return
    const view = req.query?.view
    if (view !== undefined && view !== 'evidence') return res.status(400).json({ error: 'Unknown view' })
    try {
      const payload = await buildBrief()
      const evidence = buildControlCenterEvidence(payload)
      return res.status(200).json(view === 'evidence' ? evidence : { ...payload, evidence })
    } catch {
      // Do not expose provider errors, credentials or customer records.
      return res.status(503).json({ error: 'Operating evidence is temporarily unavailable. Refresh to retry.' })
    }
  }
}
