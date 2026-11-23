#!/usr/bin/env bash
# Verifies ONE authenticated-E2E target against GitHub's record of the Vercel integration. Runs from the
# TRUSTED checkout (master), twice per run: in `verify` and again, after the reviewer wait, at the start of
# the gated job (TOCTOU). Both runs must print the same TUPLE_ID. Fails closed on anything missing or ambiguous.
#
# Inputs (env): GH_TOKEN SHA PREVIEW_URL APPROVED_SHA REPO PROD_BASELINE; optional GITHUB_OUTPUT GITHUB_STEP_SUMMARY.
# Limit: GitHub exposes no Vercel project id or deployment-id <-> hostname mapping. The tuple is bound by the
# commit SHA, one bot-created deployment, one bot-created commit-status series sharing ONE dashboard id, and
# completion times within 120 s. The Vercel API is not consulted (it would need a new credential).
set -euo pipefail
fail() { echo "::error::$1"; exit 1; }
for v in GH_TOKEN SHA PREVIEW_URL APPROVED_SHA REPO PROD_BASELINE; do [ -n "${!v-}" ] || fail "missing required input: $v"; done
api() { gh api "$1"; }
BOT='vercel[bot]'
ENV_NAME='Preview – idogs-app-staging'
CTX='Vercel – idogs-app-staging'

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "sha must be a full 40-char lowercase SHA"
url="${PREVIEW_URL%/}"
[[ "$url" =~ ^https://idogs-app-staging-[a-z0-9-]+\.vercel\.app$ ]] || fail "preview_url is not an idogs-app-staging Preview"

# 1. Approval is scoped to one reviewed SHA.
[ "$SHA" = "$APPROVED_SHA" ] || fail "sha is not the reviewed SHA (E2E_APPROVED_SHA)"

# 2. Dependency manifests must equal the production baseline.
cmp=$(api "repos/$REPO/compare/$PROD_BASELINE...$SHA") || fail "cannot read compare"
[ "$(jq '.files | length' <<<"$cmp")" -lt 300 ] || fail "diff too large to audit dependency files"
deps=$(jq -r '[.files[].filename | select(. == "package.json" or . == "package-lock.json")] | join(",")' <<<"$cmp")
[ -z "$deps" ] || fail "dependency files differ from production baseline ($deps)"

# 3a. Exactly one staging Preview deployment for this SHA, created by the Vercel integration.
deps_json=$(api "repos/$REPO/deployments?sha=$SHA&per_page=100") || fail "cannot read deployments"
cand=$(jq -c --arg e "$ENV_NAME" --arg b "$BOT" --arg s "$SHA" '[.[] | select(.environment == $e and .creator.login == $b and .sha == $s and .task == "deploy")]' <<<"$deps_json")
[ "$(jq 'length' <<<"$cand")" = "1" ] || fail "expected exactly one bot-created staging Preview deployment for this SHA"
dep=$(jq -r '.[0].id' <<<"$cand")

# 3b. Its latest status: success, by the bot, for exactly this URL.
st=$(api "repos/$REPO/deployments/$dep/statuses?per_page=100") || fail "cannot read deployment statuses"
latest=$(jq -c 'sort_by(.created_at) | last' <<<"$st")
[ "$(jq -r '.state' <<<"$latest")" = "success" ] || fail "latest Preview deployment state is not success"
[ "$(jq -r '.creator.login' <<<"$latest")" = "$BOT" ] || fail "deployment status was not posted by the Vercel integration"
[ "$(jq -r '.environment_url | rtrimstr("/")' <<<"$latest")" = "$url" ] || fail "preview_url does not match the deployment recorded for this SHA"
dep_done=$(jq -r '.created_at' <<<"$latest")

# 3c. The staging project's commit-status series: all by the bot, ONE dashboard id throughout, latest = success,
#     completed within 120 s of the deployment status.
cs=$(api "repos/$REPO/commits/$SHA/statuses?per_page=100") || fail "cannot read commit statuses"
series=$(jq -c --arg c "$CTX" '[.[] | select(.context == $c)] | sort_by(.created_at)' <<<"$cs")
[ "$(jq 'length' <<<"$series")" -ge 1 ] || fail "no staging commit status for this SHA"
[ "$(jq '[.[] | select(.creator.login != "vercel[bot]")] | length' <<<"$series")" = "0" ] || fail "staging commit status not posted by the Vercel integration"
re='^https://vercel\.com/izipawsltd-tonys-projects/idogs-app-staging/([A-Za-z0-9]+)$'
ids=$(jq -r '.[].target_url' <<<"$series" | while read -r t; do [[ "$t" =~ $re ]] && echo "${BASH_REMATCH[1]}" || echo "INVALID"; done | sort -u)
[ "$(wc -l <<<"$ids")" = "1" ] && [ "$ids" != "INVALID" ] || fail "staging commit statuses do not carry one valid dashboard deployment id"
vdep="$ids"
last_cs=$(jq -c 'last' <<<"$series")
[ "$(jq -r '.state' <<<"$last_cs")" = "success" ] || fail "latest staging commit status is not success"
d1=$(jq -n --arg a "$dep_done" '$a | fromdateiso8601'); d2=$(jq -r '.created_at | fromdateiso8601' <<<"$last_cs")
diff=$(( d1 > d2 ? d1 - d2 : d2 - d1 ))
[ "$diff" -le 120 ] || fail "commit status and deployment status completed ${diff}s apart; records are not bound to each other"

# 4. CI by workflow identity (path + event + SHA), not by display name.
runs=$(api "repos/$REPO/actions/runs?head_sha=$SHA&per_page=100") || fail "cannot read workflow runs"
ok=$(jq --arg s "$SHA" '[.workflow_runs[] | select(.path == ".github/workflows/ci.yml" and .event == "push" and .head_sha == $s and .conclusion == "success")] | length' <<<"$runs")
[ "$ok" -ge 1 ] || fail "no successful push run of .github/workflows/ci.yml for this SHA"

tuple="$SHA|$url|$dep|$vdep"
tuple_id=$(printf '%s' "$tuple" | sha256sum | cut -c1-16)
echo "TUPLE_ID=$tuple_id"
if [ -n "${GITHUB_OUTPUT-}" ]; then
  { echo "sha=$SHA"; echo "url=$url"; echo "deployment_id=$dep"; echo "vercel_deployment=$vdep"; echo "tuple_id=$tuple_id"; } >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY-}" ]; then
  { echo "### Authenticated E2E target (verified)"; echo "- SHA \`$SHA\` = reviewed SHA; Preview $url"; echo "- GitHub deployment $dep (vercel[bot]); Vercel deployment id $vdep; tuple \`$tuple_id\`"; echo "- Dependency manifests equal \`$PROD_BASELINE\`; CI = push run of ci.yml"; echo "- Limit: no Vercel API call; project id/host mapping not exposed by GitHub."; } >> "$GITHUB_STEP_SUMMARY"
fi
