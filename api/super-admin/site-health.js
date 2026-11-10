import { verifySuperAdmin } from './_auth.js'
import { createSiteHealthHandler } from '../_lib/control-center-health.js'

export default createSiteHealthHandler({ verifySuperAdmin })
