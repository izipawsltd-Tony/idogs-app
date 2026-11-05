# Owner crash report: document camera and Billing discovery

Owner reported AI scanning unavailable and no Billing button after build 90. Private pic.zip contains dog/profile and QR screenshots plus an iOS "iDogs Crashed" dialog. No native crash trace was supplied, so the precise crash cause is not proven by the screenshot.

Source inspection found camera-enabled file inputs but no build step configuring camera/photo purpose strings in the regenerated Capacitor iOS project. Missing camera purpose metadata is a concrete packaging defect consistent with termination when requesting camera access. Configure explicit NSCameraUsageDescription and NSPhotoLibraryUsageDescription after Capacitor sync in both iOS workflows. Do not add microphone, broad storage or unrelated permissions. Configuration does not request permission or grant access itself.

Use Python's standard plist parser to preserve other app metadata. Validate both descriptions in compiled simulator/device bundles and the exported signed IPA before upload. Verification is read-only so signed content is never modified. Three regressions cover an unconfigured generated plist, preservation/idempotence, binary exported plist checks rejecting missing/empty/wrong descriptions, and malformed roots.

Billing was reachable at Settings > Current plan > View plan details, while the compact native navigation intentionally omitted the purchase-oriented top-bar link. Rename the existing in-Settings link to Billing & plan details without adding a purchase path or changing entitlements. The existing native Settings-to-Billing navigation/payment-gate regressions pass.

Local validation: 3 Python plist regressions and 15 Settings/Billing/AI-consent tests PASS; whitespace check PASS. Required remaining evidence: exact-source CI, real generated/compiled/exported plist verification, signed Apple upload/VALID/internal assignment and physical camera/file selection retry. This does not yet establish a successful AI-provider extraction or physical crash resolution.

Reference: https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription

Private images remain outside the Git repository. No document was sent to an AI provider and no Production setting, policy publication, account data or billing operation was changed.
