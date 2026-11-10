import { checkSiteHealth } from '../api/_lib/control-center-health.js'

const result = await checkSiteHealth()
console.log(JSON.stringify(result, null, 2))
process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2
