# scripts/load-rules-verify-env.ps1 — loads the three FIREBASE_* env vars
# scripts/verify-rules-release.mjs needs, from a service-account key JSON
# file that lives OUTSIDE this repo (never committed). This script itself
# contains no secret material — it only reads a local file path you
# provide and copies three fields from it into the current process's
# environment. The private key is never typed into a command, so it
# never lands in PowerShell's (PSReadLine) command history.
#
# One-time setup, per project you need to verify:
#   1. Firebase Console -> Project Settings -> Service Accounts ->
#      Generate new private key. Reuse an existing key for that project
#      if one you already trust is still valid — don't generate a new
#      one just for this, to avoid key sprawl.
#   2. Save the downloaded JSON file at:
#        $HOME\.idogs-secrets\<projectId>-service-account.json
#      e.g. C:\Users\<you>\.idogs-secrets\idogs-app-staging-service-account.json
#      This directory is OUTSIDE the repo on purpose — `git add` can
#      never pick it up by accident. Restrict its permissions with
#      `icacls` if this machine is shared with other users.
#
# Usage (once per shell session, before running verify-rules-release.mjs):
#   .\scripts\load-rules-verify-env.ps1 -ProjectId idogs-app-staging
#
# When you're done, always run scripts/clear-rules-verify-env.ps1 to
# remove these env vars from the current shell session.

param(
  [Parameter(Mandatory = $true)][string]$ProjectId
)

$credPath = Join-Path $HOME ".idogs-secrets\$ProjectId-service-account.json"

if (-not (Test-Path $credPath)) {
  Write-Error "Service account key file not found: $credPath`nSee this script's header comment for how to create it. Never save it inside the repo."
  exit 1
}

$cred = Get-Content -Raw $credPath | ConvertFrom-Json

if (-not $cred.project_id -or -not $cred.client_email -or -not $cred.private_key) {
  Write-Error "Service account key file at $credPath is missing project_id/client_email/private_key — is this a genuine Firebase service account key JSON?"
  exit 1
}

if ($cred.project_id -ne $ProjectId) {
  Write-Error "Key file at $credPath has project_id '$($cred.project_id)', which does not match the requested -ProjectId '$ProjectId'. Refusing to load it — check you saved the right project's key at this path."
  exit 1
}

$env:FIREBASE_PROJECT_ID = $cred.project_id
$env:FIREBASE_CLIENT_EMAIL = $cred.client_email
$env:FIREBASE_PRIVATE_KEY = $cred.private_key
Remove-Variable cred

# Deliberately never echo the values themselves — only confirm which
# project was loaded and from where.
Write-Host "Loaded FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY for project '$($env:FIREBASE_PROJECT_ID)' from $credPath (values not printed). Run scripts\clear-rules-verify-env.ps1 when done."
