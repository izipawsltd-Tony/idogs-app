#!/usr/bin/env bash
# Runs the credentialed Playwright invocation so that NOTHING from it reaches the job log or an artifact.
# stdout/stderr and the raw JSON report go to a private (0700) scratch directory that is removed on EVERY
# exit path (success, test failure, parse failure, summarizer crash, INT/TERM). Only the allowlisted summary
# (fixed enums and numbers, see summarize-e2e-report.mjs) is written to $OUT_DIR. Exit status is the summarizer's.
#
# env: TRUSTED_DIR (checkout of the trusted ref with scripts/ and e2e/support/silent-reporter.ts)
#      WORKDIR (the candidate checkout)   OUT_DIR (published summary dir)
#      E2E_CMD (optional override, used by tests)   SUMMARY_ARGS (optional extra summarizer args)
set -uo pipefail
: "${TRUSTED_DIR:?}" "${WORKDIR:?}" "${OUT_DIR:?}"
scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/e2e-scratch.XXXXXX") || exit 2
chmod 700 "$scratch"
cleanup() { rm -rf "$scratch"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
mkdir -p "$OUT_DIR"

export PLAYWRIGHT_JSON_OUTPUT_NAME="$scratch/raw.json"
cmd="${E2E_CMD:-npx playwright test --reporter=json,$TRUSTED_DIR/e2e/support/silent-reporter.ts}"
( cd "$WORKDIR" && bash -c "$cmd" ) >"$scratch/stdout.log" 2>"$scratch/stderr.log" </dev/null
code=$?

# The summarizer's own stdout/stderr are captured privately too; only the fixed summary file is published.
rm -f "$OUT_DIR/summary.json"
# shellcheck disable=SC2086
node "$TRUSTED_DIR/scripts/summarize-e2e-report.mjs" --raw "$scratch/raw.json" --exit "$code" --out "$OUT_DIR/summary.json" ${SUMMARY_ARGS:-} >"$scratch/sum.out" 2>"$scratch/sum.err" </dev/null
status=$?
# Fail closed: a missing/empty summary, an unexpected summarizer exit code, or a summary that is not exactly
# a pass while the exit code is 0, all publish only the fixed BLOCKED summary.
if [ ! -s "$OUT_DIR/summary.json" ] || { [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; }; then
  echo '{"result":"blocked","reason":"internal_error"}' > "$OUT_DIR/summary.json"
  status=1
fi
exit "$status"
