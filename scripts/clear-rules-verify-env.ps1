# scripts/clear-rules-verify-env.ps1 — removes the three FIREBASE_* env
# vars scripts/load-rules-verify-env.ps1 set, from the current shell
# session's process environment. Always run this after you're done with
# scripts/verify-rules-release.mjs, so the service-account key doesn't
# linger in this session's environment any longer than it needs to.
#
# Usage:
#   .\scripts\clear-rules-verify-env.ps1

Remove-Item Env:\FIREBASE_PROJECT_ID -ErrorAction SilentlyContinue
Remove-Item Env:\FIREBASE_CLIENT_EMAIL -ErrorAction SilentlyContinue
Remove-Item Env:\FIREBASE_PRIVATE_KEY -ErrorAction SilentlyContinue

Write-Host "Cleared FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY from this shell session."
