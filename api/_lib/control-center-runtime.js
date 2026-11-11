import { getFirestore } from 'firebase-admin/firestore'
import { buildAiCeoV12 } from './ai-ceo-v12.js'
import { assertAssistantDatabase } from './control-center-ai-budget.js'
import { createBriefCache } from './control-center-cache.js'

export const getControlCenterBrief = createBriefCache(() => {
  // The dashboard and assistant share this read path. Reject preview database
  // mismatches before loading records or labeling them as staging evidence.
  if (process.env.VERCEL_ENV === 'preview') {
    assertAssistantDatabase('preview', getFirestore().projectId)
  }
  return buildAiCeoV12()
})
