import { readFileSync, writeFileSync } from 'node:fs'
// Generate an isolated prototype from the existing ownership/schema policy.
// Do NOT replace/deploy firestore.rules as part of preparing local QA.
let rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const anchor = '    function isSignedIn() {\n      return request.auth != null;\n    }'
if (!rules.includes(anchor)) throw new Error('Review the current policy before generating onboarding rules')
rules = rules.replace(anchor, `    // Prototype readiness record: Admin-only {uid,email,version:1}.
    // Client ownership/schema validators below remain unchanged.
    function primaryAccountReady() {
      let path = /databases/$(database)/documents/accountReadiness/$(request.auth.uid);
      return request.auth.token.get('email_verified', false) == true &&
        request.auth.token.get('firebase', {}).get('sign_in_provider', '') == 'password' &&
        request.auth.token.get('email', '') != '' && exists(path) &&
        get(path).data.version == 1 && get(path).data.uid == request.auth.uid &&
        get(path).data.email == request.auth.token.email.lower();
    }
    function isSignedIn() {
      return request.auth != null && primaryAccountReady();
    }`)
rules = rules.replace('return isSignedIn() && request.auth.uid == userId;', 'return request.auth != null && request.auth.uid == userId;')
rules = rules.replace('allow update: if isOwnerUser(userId) &&', `allow update: if isOwnerUser(userId) && (isSignedIn() ||
        (request.auth.token.get('email_verified', false) == true &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly(['email']) &&
         request.resource.data.email == request.auth.token.email)) &&`)
rules = rules.replace('allow delete: if isOwnerUser(userId) &&', 'allow delete: if isOwnerUser(userId) && isSignedIn() &&')
writeFileSync(new URL('../qa/onboarding.firestore.rules.local', import.meta.url), rules)
writeFileSync(new URL('../qa/onboarding-rules-analysis.local', import.meta.url), 'Prototype derived from existing firestore.rules. Only readiness helper and users update/delete gates change. Existing ownership/schema/PII/billing validations and public QR/landing policy are retained. users own read/minimal bootstrap create remain available; readiness/recovery collections default-deny clients. All client queries remain in source scan onboarding-data-scan.local; query shapes are unchanged. Storage direct access remains deny-all; trusted upload endpoints use verifyAccountToken. Not a production policy deployment.\n')
