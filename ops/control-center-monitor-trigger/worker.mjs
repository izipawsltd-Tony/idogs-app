// Cloudflare Worker: an external clock for the Control Center website monitor.
// GitHub `schedule` runs for this repository arrive hours late, so this Worker
// asks GitHub to start the existing monitor workflow every 10 minutes through
// `workflow_dispatch`. The probe, state and logs stay in GitHub Actions.
//
// The Worker only starts one fixed workflow on one fixed branch. It never
// contacts idogs.com.au, never reads repository content and never sends email.
// Secret (set by the Owner in Cloudflare, never committed):
//   GITHUB_DISPATCH_TOKEN  fine-grained token, this repository only,
//                          permission "Actions: Read and write", nothing else.
const OWNER = 'izipawsltd-Tony'
const REPO = 'idogs-app'
const WORKFLOW = 'control-center-monitor.yml'
const REF = 'master'

export function dispatchRequest(token) {
  if (typeof token !== 'string' || token.length < 20) throw new Error('GITHUB_DISPATCH_TOKEN is not set')
  return {
    url: `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'idogs-control-center-monitor-trigger',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: REF, inputs: { trigger: 'external-cron' } }),
    },
  }
}

// Returns a log line. GitHub answers 204 (or 200 with run details) on success.
export async function dispatchMonitor(env, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const at = now().toISOString()
  try {
    const { url, init } = dispatchRequest(env.GITHUB_DISPATCH_TOKEN)
    const response = await fetchImpl(url, init)
    const ok = response.status === 204 || response.status === 200
    return { ok, line: `${at} dispatch ${ok ? 'OK' : 'FAILED'} HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, line: `${at} dispatch FAILED ${error instanceof Error ? error.message : 'unknown error'}` }
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchMonitor(env).then(result => console.log(result.line)))
  },
  // No public HTTP surface: every request gets 404.
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
}
