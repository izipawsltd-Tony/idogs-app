import { buildAiCeoV12 } from './ai-ceo-v12.js'
import { createBriefCache } from './control-center-cache.js'

export const getControlCenterBrief = createBriefCache(buildAiCeoV12)
