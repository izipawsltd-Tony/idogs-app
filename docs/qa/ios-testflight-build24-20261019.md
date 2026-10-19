# iOS 1.0 (24): AI permission and release version alignment

Runtime source: `fe3cf57adaf151ed6f78e1d8d459010b1ddd068a`.

- Each selected document now requires explicit permission before AI processing. Disclosure identifies Anthropic, full-document personal information exposure, dog-profile storage, AI verification and manual entry alternative. No persistent blanket consent.
- Cancel and reselect do not call the network. A synchronous in-flight guard prevents duplicate scan submissions. The document picker supports keyboard activation.
- Settings links directly to Privacy and Terms. Existing legal policy text was not rewritten or certified.
- Signed iOS marketing version is 1.0, aligned with the existing App Store version record. No build was selected for public submission.

## Verified

Local: 135 Vitest tests, four native environment checks, TypeScript/Vite production build and whitespace check passed. The two added permission tests use synthetic PDFs and mocked network/FileReader only; no real AI processing, documents or usage charges. Production bundle contains the consent interface. Existing billing, offline-read and auth tests remain green. Existing bundle-size warning remains.

Cloud at exact runtime SHA:

- [Signed TestFlight run 39180581085](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39180581085): SUCCESS; job 117832269769.
- Log 2026-10-19T00:28:05.7295430Z: `UPLOAD SUCCEEDED with no errors`.
- Log 2026-10-19T00:30:13.5913260Z: `Internal tester assignment PASS for build 24 (1 tester(s))`. The step waits for VALID and verifies the existing tester relationship after assignment.
- IPA evidence artifact 12156197330; archive digest `sha256:548b9d716b545648689bf23950b1ee2c718bbe2e65ba66b59c891be2435f145b`.
- [Unsigned iOS simulator/ARM64 run 39180581099](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39180581099): SUCCESS.
- CI [39180581081](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39180581081) and [39180586016](https://github.com/izipawsltd-Tony/idogs-app/actions/runs/39180586016): SUCCESS.

## Limits and owner gates

No physical iPhone QA of the new consent interface was performed by the agent. Build 20 device QA remains historical evidence; do not relabel it Build 24 full regression. Build/upload/tester delivery PASS does not establish App Store approval readiness.

Account deletion implementation still needs the retention/shared-history/billing decision in [the deletion proposal](../release/account-deletion-owner-decision.md). The existing helper is unsafe to expose. Provider processing and retention facts and legal publication require review in [the AI privacy draft](../release/ai-privacy-owner-review.md). StoreKit/billing policy, missing App Store metadata/screenshots/reviewer access and stacked-branch integration remain unresolved. PR #25 remains draft. No PR merge, production deployment, App Review submission or public release was authorized or performed.
