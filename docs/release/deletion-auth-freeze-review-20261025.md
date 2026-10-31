# Auth freeze and privacy draft checkpoint

Source follows integration commit a858f4811d678e7ff611c26666bc7c17c6e4f93c. Build 43 remains the signed, owner-verified iPhone binary. These backend changes remain emulator-only.

## Deletion safety

Before any destructive operation, bind the planned Auth identity (UID, creation time, email, phone and providers), disable it, revoke refresh tokens and read back the same disabled identity. Abort if freezing or identity verification fails. Retry verifies the binding again. An Auth deletion intent is recorded only after data verification, so retry can distinguish a prior removal attempt from an unexpectedly missing identity.

The final residual inventory checks both profile and Auth email hashes, including when those emails differ. Operation hashes are checked again during final verification, including operations already receipted. A recreated Auth identity is preserved and completion refused.

Firebase Auth deletion does not provide a conditional compare-and-delete transaction with Firestore. Privileged out-of-band Admin/console changes still require operational fencing; this is not a claim of atomic protection against an unrestricted administrator. Production ingress, real provider adapters, upload draining and retention/backup/restore evidence remain unresolved prerequisites. No production enable switch or deployment is added.

## Portal readback

Apple login was restored and verified against IZIPAWS PTY LTD / iDogs (6823094602). The App Privacy draft Email Address purpose now includes App Functionality and Developer’s Advertising or Marketing, remains linked to identity and not used for tracking. This reflects the optional email marketing preference integrated from the live source. No privacy publication or App Review submission occurred. Other marketing-purpose mappings require reconciliation with the final campaign implementation.

Privacy Policy URL remains blank while the policy is not effective. No final App Store build is selected. Device screenshots and reviewer login QA remain outstanding. Firebase Console redirects to the signed-out Google account chooser, so actual project/bucket/backup metadata has not been verified in this session.
