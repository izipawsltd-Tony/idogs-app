# Android v20 runtime QA — 2026-10-07

Installed from Google Play: `au.com.idogs.app`, versionCode **20**, versionName **0.1.20**, installer `com.android.vending`. Release source: `e4a2a4297376e12705b14ef86857068f4b54aa8e`.

Device: Windows emulator `emulator-5554`, Android 17 / API 37, 1080×2400, 2 GB RAM. No physical Android device was available.

Fixture: **QA-v20-20261007-TEST-ONLY**, Labrador Retriever, Female, DOB 2026-10-07. Passport **QA--2026-Q74L**. All records are synthetic QA data, not real treatment.

| Check | Observed result |
| --- | --- |
| Upgrade/login | PASS — v19 → v20 update through Play; existing login retained. |
| Dog create/reopen | PASS — new fixture saved and found after force-stop/relaunch. |
| Public QR | PASS — decoded screenshot payload equals `https://idogs.com.au/p/QA--2026-Q74L`, matching the displayed Public URL. |
| Worming optional fields | PASS — `QA-v20-Worming-TEST-ONLY`, given 2026-10-07, next due and weight blank; saved and retained after force-stop/relaunch. |
| Manual PDF | PASS — 1511-byte QA PDF, title `QA-v20-PDF-TEST-ONLY`, notes `QA-No-medical-record`; global count 26 → 27, exactly one record. |
| Manual PNG | PASS — existing green `qa-v19-fixture.png` reused as image input; title `QA-v20-PNG-TEST-ONLY`; global count 27 → 28, exactly one record. |
| Global document View | PASS — PDF opened in external Chrome and visibly rendered the expected three QA lines. |
| Dog document View | PASS — PNG opened in external Chrome and visibly rendered the expected green QA image after loading. |
| Mobile rename | PASS — Dog Documents Save/Cancel visible; PDF renamed `QA-v20-PDF-EDIT-SAVED`; attempted `QA-v20-CANCEL-MUST-NOT-SAVE` cancelled without changing the saved name. Edited name also confirmed in the global list after another force-stop/relaunch. |
| Document persistence | PASS — both manual records and the edited PDF name present after force-stop/relaunch. |
| Valid Scan extraction | PASS — fictional vaccination image extracted one C5 vaccine, given 2026-10-07, next due 2026-10-28, clinic `QA Test Clinic`; vaccine count 0 → 1 and linked Vaccine Card document created. Source image opened correctly; all extracted fields persisted after another force-stop/relaunch. Global document total became 29. This consumes one authorized QA scan. |
| Offline smoke check | LIMITED — cached Dog/Documents remained visible and app stayed foreground without crashing during a short network interruption. View failure feedback was not captured; full offline handling is not certified. Original enabled network transports restored and connectivity validated; online View then rendered the expected Scan source image. |
| Offline cold start | FAIL on installed v20 — airplane mode enabled and active default network confirmed `none`; after force-stop/relaunch Home rendered zero Dogs, Documents, Litters and Reminders. Only the separate pending-claim check showed a loading error. After restoring network and navigating away/back, actual counts returned (29 Dogs, 29 Documents, 3 Litters, 16 overdue reminders). No records were deleted. |

## Evidence on the Windows QA machine

`C:\Projects\idogs-play-internal-ready\v20-e4a2a429\`: `qa-v20-qr.png`, `qa-v20-pdf-view.png`, `qa-v20-png-view-warm.png`, `qa-v20-documents-persist.png`, `qa-v20-offline.png`, `qa-v20-offline-cold.png`, `qa-v20-scan-view.png`, `qa-v20-scan-persist.png`, `qa-v20-relaunch.png`, and the synthetic Scan fixture `qa-v20-scan-vaccine.png`.

## Follow-up fix and release gate

Global Documents cards still squeeze titles/notes into a narrow column beside actions on mobile. A follow-up source change uses a two-column mobile grid with a separate full-width action row.

The cold-offline failure was reproduced using the real installed Firestore SDK with networking disabled, no credentials and no production data: default query reads returned an empty cache as successful empty lists. The follow-up changes `db.ts` collection reads to `getDocsFromServer`, allowing existing unavailable/Retry UI to handle an offline read instead of displaying false zeroes. Six SDK regression cases were added; before the fix, five application checks failed by resolving `[]`; after the fix, all six passed.

Follow-up validation: **121 Vitest tests**, **4 native environment guards**, TypeScript/Vite build and `git diff --check` passed. These source fixes are **not installed v20** and require native verification in the next candidate. The layout-only v21 build was cancelled after discovery of the offline blocker; the next build includes both follow-up fixes.

The four v19 regression fixes and synthetic Scan checks passed. **Installed v20 is not Android Production ready because cold-offline behavior failed.** Remaining coverage: native verification of the offline fix and follow-up layout, PetOwner/transfer on isolated accounts, archive/restore with a suitable QA ownership-history fixture, comprehensive offline behavior and physical-device testing. No real transfer, public Production rollout, billing payment, email or SMS was performed.

## v22 Play distribution check — 2026-10-07

Candidate: versionCode **22**, versionName **0.1.22**, source SHA `10d1eb57064cd30873de0e5d2168166cabac98ba`. Signed AAB path: `C:\\Projects\\idogs-play-internal-ready\\v22-10d1eb57\\iDogs-v22-0.1.22.aab`.

On tester emulator `emulator-5554`, the installed Play build remained **20 / 0.1.20** with installer `com.android.vending`. The Play Store app details page for `au.com.idogs.app` rendered **Uninstall** and **Open**, with no **Update** action. Therefore v22 was **not yet available to this Internal Testing tester** at the time of the check.

Result: **BLOCKED at Play distribution gate**. Native v22 cold-offline, Retry/network recovery, Global Documents layout and regression smoke were **not executed** and are **not PASS**. No sideload was used because this QA stage requires installation through Google Play Internal Testing.

## v22 Internal Testing rollout — 2026-10-08

Google Play Console Internal testing release was created from the signed AAB `iDogs-v22-0.1.22.aab` (versionCode **22**, versionName **0.1.22**; source SHA `10d1eb57064cd30873de0e5d2168166cabac98ba`). Upload completed and Play recognized artifact **22 (0.1.22)**, target SDK 36. Validation showed one non-blocking warning: no deobfuscation file associated with the App Bundle. No blocking errors were shown.

The release was confirmed with **Save and publish**. Internal testing then showed **Latest release: 22 (0.1.22)**, status **Available to internal testers**, released Oct 8 2026 at approximately 3:15 PM Adelaide time.

Immediate post-publish tester check: emulator package was still **20 / 0.1.20** with installer `com.android.vending`; Play propagation had not yet reached that tester at the first check. Native v22 QA remains pending until the tester can update through Google Play.

## v22 tester propagation and Play update — 2026-10-08

At approximately 21:53 Adelaide time, Google Play Internal Testing propagation reached the emulator tester account `izipawsltd@gmail.com`. After refreshing the Play Store entitlement and restarting the emulator, the iDogs listing showed **Update**. The update was installed through Google Play (no sideload).

Post-update package evidence on `emulator-5554`: versionCode **22**, versionName **0.1.22**, installer `com.android.vending`, lastUpdateTime `2026-10-08 21:53:12`. Play Store then showed **Open** / **Uninstall**.

## Native v22 regression — 2026-10-08

Installed through Google Play Internal Testing: versionCode **22**, versionName **0.1.22**, installer `com.android.vending`.

| Check | Result |
| --- | --- |
| Cold offline | PASS — with airplane mode/data/Wi-Fi disabled and cold app start, Home displayed loading-error guidance, Retry controls and em dashes instead of false zero counts. Screenshot: `qa-v22-offline-cold.png`. |
| Network restore / Retry | PASS — network was restored; Retry reloaded actual account data (28 dogs before new QA fixture, 26 documents, 3 litters, 14 overdue reminders). Screenshot: `qa-v22-retry-restored.png`. |
| Global Documents mobile layout | PASS — card metadata remained readable and View / Remove actions rendered on a separate action row. Screenshot: `qa-v22-documents-layout.png`. |
| Isolated QA fixture | PASS — created synthetic dog `QA-v22-20261008-TEST-ONLY`, Labrador Retriever, Female, DOB 2026-10-08. Passport ID `QA--2026-3B8N`. |
| QR Passport | PASS — Public URL displayed `https://idogs.com.au/p/QA--2026-3B8N`. Screenshot: `qa-v22-qr.png`. |
| Worming optional fields | PASS — `QA-v22-Worming-TEST-ONLY`, date given 2026-10-08, Next due and Weight left blank; saved successfully and tab became Worming (1). |
| Manual PDF upload | PASS — uploaded existing synthetic 1.5 KB QA PDF to the v22 QA dog only; global count 26 → 27 and dog Documents 0 → 1. |
| PDF View | PASS — View opened the synthetic PDF in Chrome and visibly rendered the expected QA text. Screenshot: `qa-v22-pdf-view2.png`. |
| Rename | PASS — Dog Documents Edit/Save renamed the QA PDF to `QA-v22-PDF-EDIT-SAVED`. |
| Persistence | PASS — after force-stop/relaunch Home showed 29 Dogs / 27 Documents and recent activity included `QA-v22-PDF-EDIT-SAVED` plus worming activity for the QA dog. |

No real ownership transfer, billing, email/SMS or destructive operation on a real dog was performed. Network state was restored after the offline test.

Remaining Android Production-gate coverage is unchanged: isolated PetOwner/transfer flow, archive/restore with a suitable synthetic fixture, and physical Android-device testing. No physical Android phone is currently available.
