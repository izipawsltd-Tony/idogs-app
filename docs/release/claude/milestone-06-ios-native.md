# iDogs — Milestone Report 06: iOS native defects fixed (no gate needed)
Date: 01 Nov 2026, ~21:10 Adelaide · Author: Claude · Coordinator review of #70/#72 still pending — no integration performed.

## Fixed
| # | Defect | Impact | Fix | Line / commit |
|---|---|---|---|---|
| 1 | Missing `NSMicrophoneUsageDescription` while puppy-media upload (reachable in the native app) offers **Take Video** | iOS terminates the app when a breeder records a video → **crash / likely App Review rejection** | Purpose string added in `mobile/scripts/ios_privacy.py` and enforced by its unit test, which CI, the iOS Build and TestFlight workflows already run | iOS #67 `b74d6d2` |
| 2 | `capture="environment"` on iDogs Scan + dog photo inputs | iOS/mobile Safari opened **camera only**: no Photo Library, no Files, so **PDF documents could not be scanned** | Attribute removed; the system picker offers Take Photo / Library / Files | iOS #67 `b74d6d2`, Web #68 `7b6c4eb` |
| 3 | `/qa/phone-sign-in`, `/qa/phone-email-link` registered in every build | QA-only code reachable in Production builds (charter: "ship no QA-only routes to Production") | Routes registered only when the staging QA flag is on; a Production-config build no longer contains them (bundle checked) | iOS #67 `b74d6d2` |

Regression tests: `src/lib/iosNativeReadiness.test.ts` (iOS) and `src/lib/filePickerSources.test.ts` (web).

## CI evidence
- iOS #67 `b74d6d2`: iDogs CI run 41291044108 ✅ — typecheck/tests (508) ✅, phone-to-email emulator ✅, **Unsigned iOS Simulator compile ✅**. The log shows `iOS camera, photo and microphone purpose strings verified` on the built app and `** BUILD SUCCEEDED **`.
- Web #68 `7b6c4eb`: iDogs CI ✅ (push + PR), 536 tests.

## Checklist updates (`ios-release-checklist.md`)
- B6: the picker must offer Photo / Library / Files, and a PDF scan must succeed.
- B10b: Take Video shows the mic prompt and does not crash.
- C7: App Privacy must declare puppy videos incl. audio (Audio Data / Photos or Videos).

## Note for TestFlight (G4)
These are **binary-affecting** changes (Info.plist key, file pickers). Owner-PASS build 92 does **not** contain them. A new signed build of the iOS candidate is needed before App Store submission → G4 then G5.

## Still waiting
- Coordinator review of #70 (`1ba38f8`) / #72 (`94a75f4`) before integration into #68 / #67. The automation PRs are stacked on the release PRs, so the new release commits do not need re-review there.
- Owner: Vercel bypass secret, Anthropic key with spend limit, `testflight` environment reviewer.
- Gates G3–G8 not approved.
