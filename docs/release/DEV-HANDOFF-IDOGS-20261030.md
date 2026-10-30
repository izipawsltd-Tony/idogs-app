# BÀN GIAO iDogs — BUILD, QA VÀ PHÁT HÀNH
Ngày chốt: 30/10/2026, múi giờ Australia/Adelaide.
Tài liệu này thay thế việc phải đọc lại toàn bộ chat. Đây là snapshot đã kiểm chứng, không phải xác nhận app đã sẵn sàng Production và không cấp thêm quyền phát hành.

## 1. Mục tiêu và trạng thái trong một phút

Owner muốn đưa iDogs ra sử dụng công khai/gửi App Review sớm nhất, workflow khoảng 98% tự động. Tự làm liên tục phần kỹ thuật đã duyệt, làm song song các phần độc lập; không hỏi xác nhận sau mỗi batch, không tạo binary chỉ để tăng số build. Chỉ dừng khi hoàn tất phạm vi hoặc có Owner Gate thật.

App CHƯA public trên App Store, CHƯA gửi App Review. Version 1.0 đang PREPARE_FOR_SUBMISSION. Build 92 đã Owner PASS và đang được chọn. Backend release có nhiều thành phần deletion/renewal/recovery đã QA, nhưng vẫn có guard chỉ emulator/isolated QA; chưa có live fulfilment worker và toàn bộ route/authority/Privacy vận hành.

Bản runtime mới nhất được kiểm chứng: e74bc49ab002309ad2dede6aa1e031e2207af42f.
HEAD local/remote tại lúc bắt đầu bàn giao: ee77e1ec9b04f098875087d5eb3e3d92ba77bddf (chỉ thêm evidence docs).
Tài liệu bàn giao có thể nằm ở commit docs mới hơn; không coi đó là runtime mới.

131/131 actual emulator tests, 480 unit tests, TypeScript/build và actual isolated-cloud QA PASS; cleanupVerified:true, productionReady:false. Không gửi email hoặc simulation. QA PASS không có nghĩa đã activate Production.

## 2. Repo, checkout và tránh mất công việc

- GitHub: https://github.com/izipawsltd-Tony/idogs-app
- Nhánh tiếp tục: release/ios-app-store-20261025
- PR đang OPEN: https://github.com/izipawsltd-Tony/idogs-app/pull/62
- Workspace: C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN
- Checkout đúng: C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN/ios-consolidated
- Checkout này hiện DETACHED HEAD, working tree sạch tại lúc chốt. Các commit đã push về nhánh release ở trên.
- Không chuyển sang main hoặc reset/clean để “đồng bộ”. Đọc git status/diff trước mọi sửa; giữ các thay đổi mới của người khác.
- Worktree chính pr61 đang ở feature/puppy-lifetime-updates-20261028. Không dùng nhầm worktree đó để làm tiếp task này.
- Worktree production-plus-ui-20261028 là bản UI offer cũ; không phải baseline Production mới nhất.
- Repo dùng chung .git với các worktree. Không archive/xóa/move worktree tự tiện.
- node_modules của ios-consolidated là JUNCTION trỏ sang ../pr61/node_modules. Không npm ci/xóa đệ quy trong checkout này nếu chưa xử lý rõ junction; có thể ảnh hưởng worktree khác.
- remote.origin.fetch hiện chỉ theo một nhánh QA cũ. Vì vậy origin/release/... có thể KHÔNG tồn tại dù nhánh trên GitHub vẫn đúng. Đã xác minh nhánh remote bằng git ls-remote và PR headRefOid; không coi thiếu remote-tracking ref là mất code.
- README.md gốc là hướng dẫn ban đầu, có ví dụ tạo Firebase project/Rules cũ. KHÔNG dùng nó làm runbook triển khai hiện tại, không paste Rules từ README lên cloud.

Kiểm tra an toàn trên máy hiện tại:

    Set-Location -LiteralPath 'C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN/ios-consolidated'
    git -c safe.directory='C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN/ios-consolidated' status --short
    git -c safe.directory='C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN/ios-consolidated' rev-parse HEAD
    git -c safe.directory='C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN/ios-consolidated' worktree list
    git -c safe.directory='C:/Users/Tom/Documents/ChatGPT/iDOGS BUILD & RUN/ios-consolidated' ls-remote origin refs/heads/release/ios-app-store-20261025

Sau khi kiểm tra sạch và cần tiếp tục detached checkout, cách push đã dùng là git push origin HEAD:release/ios-app-store-20261025. Không force-push.
Nếu dev mới làm ở máy khác, clone riêng nhánh release vào thư mục mới, không sao chép junction/.env/cookies/credentials:

    git clone --branch release/ios-app-store-20261025 https://github.com/izipawsltd-Tony/idogs-app.git idogs-release

Dev mới cần quyền repo/CI hợp lệ do Owner cấp. Quyền trình duyệt hoặc connector của chat cũ không tự chuyển sang người/máy khác; không xuất secret để “bàn giao quyền”.

## 3. Stack và bản đồ source

Web: React 18 + TypeScript + Vite 5. Backend: các Vercel API handlers trong api/ và helper api/_lib/. Firebase Auth, Firestore và Storage. Billing Stripe; scanning Anthropic; các luồng SMS/email có provider riêng, không thay cấu hình trong scope hiện tại.

Mobile: Capacitor 8.5.2 trong mobile/, dùng web bundle từ dist. App/bundle ID khóa au.com.idogs.app. App Store app ID 6823094602.
CI dùng Node22; Java21 và firebase-tools14.12.0 cho emulator. Native production phải đúng Firebase idogs-app/idogs-app.firebaseapp.com; không trộn project QA với Production API.

Các điểm vào quan trọng:
- mobile/capacitor.config.ts; src/lib/nativeApiRouting.ts; src/lib/nativeBillingRender.test.ts.
- api/account-deletion.js; api/_lib/account-deletion.js; account-deletion-policy.js; account-deletion-inventory.js.
- deletion-plan.js; deletion-processor.js; deletion-fence.js: inventory, quyền sở hữu, worker, lock và mutation lease.
- deletion-renewal-dispatcher.js; deletion-renewal-queue.js; deletion-billing.js: renewal task/queue, epoch lease, pinned ownership và provider receipts.
- deletion-document-ingress.js; deletion-document-storage.js: metadata/Storage intent và recovery.
- deletion-independent-ledger.js; deletion-intake.js; deletion-intake-permit.js: independent accepted/completed chain, intent/source barrier/ACK và prepared withdrawal.
- deletion-completion-outbox.js: recipient capture và completion_bound_no_send; KHÔNG có sender.
- scripts/qa/: cloud fixture wrappers và manifest guards.
- scripts/qa/app-store-readiness.mjs: GET-only App Store inventory; không xuất contact/credential/raw response.
- vercel.json hiện chỉ có cron cleanup showcase media, KHÔNG có Production deletion cron.
- shared/plus-promotion.js là nguồn lịch/terms offer; đừng chỉnh riêng UI để đổi nghiệp vụ.

## 4. Nghiệp vụ và quyết định Owner đã chốt

- Giá tải app miễn phí, chỉ Australia, rating thực tế tại Australia18+. Đã có API readback, không cần hỏi lại Owner.
- App Privacy email đã được Owner khai báo liên kết danh tính; nhãn portal vẫn cần readback cuối trước phát hành.
- iDogs Scans / iDogs Document Scans là nhãn UI đã được Owner PASS. Không đổi ngược thành AI Scans / AI Document Scans.
- Không được xóa disclosure AI/Anthropic/consent chỉ vì đổi nhãn thương hiệu. Có consent riêng cho tài liệu, lựa chọn nhập tay, disclosure xử lý ngoài nước/default30days.
- Owner đã đối chiếu Production Anthropic thuộc izi’s Individual Org, default retention30days, không ZDR. Không hỏi lại hoặc lấy/xuất API key.
- Plus: A$0/tháng đến hết31/01/2027 theo Adelaide, sau đó A$7/tháng từ01/02/2027, gồm GST; cần payment details, tự gia hạn trừ khi hủy. SMS và extra litters không nằm trong offer. Không tự đổi quota, giá hoặc schedule từ nội dung screenshot.
- UI offer web đã live từ source4d520a069e6697564a47a38e71468924c17b0ce1; baseline Production hiện tại đã mới hơn nhiều.
- Native có payment/checkout fences. Không thêm external checkout link vào iOS hoặc giả định web offer A$0 là StoreKit.
- tenantId/original breeder không phải căn cứ duy nhất để xóa chó. currentOwnerId và dữ liệu của chủ hiện tại/khác phải được bảo toàn; chuyển quyền, lịch sử, media chung và tài chính cần review.
- Chỉ exact dogs/{id} ở cấp gốc được dùng làm dog ownership authority. puppyFollowers/{uid}/dogs/{sameId} không phải bản ghi chó gốc.
- Buyer/finance: phải giữ idempotency, kiểm tra ownership trong transaction, linked-invoice validation và buyer contacts của Production.
- Cancellation không tự khởi động lại subscription đã dừng renewal.
- Nhận yêu cầu xóa, target date và completed receipt là ba việc khác nhau. Không xác nhận xóa hoàn tất chỉ từ thời gian, object404, handler return hoặc QA flag.
- Unknown/mất phản hồi giữ hold và evidence; không thay fixture, không force-close lease hoặc “retry cho PASS”.
- Owner đã cho dùng ảnh resize cho bộ App Store. Tám asset đã COMPLETE; không yêu cầu đổi điện thoại/chụp lại nếu không có lỗi cụ thể.

Lịch sử ngắn: Owner đã test nhiều build77,82,83,84...; build91 đã scan PASS. Build92 sau form/naming fixes được Owner PASS. Build93 VALID nhưng hiện không chọn; backend/offer-only work không cần binary giống hệt và không bắt Owner test lại.

## 5. iOS/App Store: bằng chứng cuối

Build92 signed workflow40494690237, sourcee7af04ae7a36bf7018af90796a3bc3a6d06e759b.
Build93 workflow40499306585, sourced557d052c85ef687b6c60eb361cfdea308dfc6e1, VALID nhưng không chọn.

GET-only App Store run40975496344 trên source65f62f69e1966436ff844628fadeccb271dc4b99 SUCCESS.
checkedAt2026-10-29T23:47:37.551Z =30/10/2026 lúc10:17:37Adelaide:
- Version1.0 PREPARE_FOR_SUBMISSION, build92 selected,92/93 VALID/unexpired.
- Hai nhóm APP_IPHONE_61 và APP_IPHONE_58, mỗi nhóm4 screenshots COMPLETE.
- Reviewer contact/demo credentials/notes có cấu hình; không lưu giá trị credential trong tài liệu.
- releaseType AFTER_APPROVAL. Gửi review có thể dẫn đến public tự động khi Apple duyệt; không coi đây là manual-release.
- Complete territory inventory: chỉ AUS available, availableInNewTerritories:false.
- Một lịch giá AUS/AUD0.0, start/end null; free-download configuration verified.
- Actual calculated AUS rating EIGHTEEN_PLUS; override V2 cũng EIGHTEEN_PLUS. Legacy global SEVENTEEN_PLUS được báo riêng, không dùng nó để kết luận AUS sai.
- Chưa verified: App Privacy labels/legal agreements cuối, actual reviewer login, screenshot visual content, effective public policy/operational fulfilment.
- CUA lần audit cuối có zero tabs; lỗi login cũ không phải bằng chứng phiên hiện tại còn lỗi. Không lặp hỏi login khi còn engineering độc lập.

Artifact allowlisted trên máy:
release-audit-20261030/app-store40975496344/idogs-app-store-readiness-65f62f69e1966436ff844628fadeccb271dc4b99/app-store-readiness.json.

Workflow .github/workflows/mobile-ios-store-readiness.yml chỉ GET, dùng secret sẵn có bên trong Actions, chạy9 contracts trước đọc Apple. Không lấy Apple signing key ra máy/chat.
Workflow mobile-ios-testflight.yml chỉ upload khi workflow_dispatch hoặc commit message chứa [testflight]; build number là GitHub run_number. Chỉ dùng khi binary thật sự thay đổi và đã review.

## 6. Production không được ghi đè bằng nhánh release

Last authenticated observed Production:
- READY dpl_9booKHNqKn3AvaFddWQS7UCa2Ebt
- SHA70b813b8b4802fd3467e00457bbdb725eca6cc00
- https://idogs.com.au và https://www.idogs.com.au

Đây là last observed, phải GET lại ngay trước khi lắp selective activation candidate.
Release branch thiếu code mới trên Production. Whole-branch deploy sẽ có nguy cơ mất puppy/media/Meta và buyer/finance behavior. Source audit thấy113 backend files khác nhau tại baseline được ghi trong selective-integration-plan.

Phải giữ:
- purpose=puppy-update, canPublish và puppyProfiles/{dogId}/media/{mediaId} trong upload/confirm.
- puppy-updates policy/author/current-owner access; follower/grouped/cross-dog references.
- Buyer contacts ownerUid query, finance requestId idempotency, fresh ownership/linked invoices/prepareFinanceBuyer.
- Meta consent, native/private-page exclusions và withdrawal controls.
- Independent SMS billing và readback.
Không copy nguyên live route bằng bản release cũ. Chuẩn bị selective patch trên baseline mới đã đọc lại; không đổi guard thành Production mode để gọi là đã activate.

Privacy source trên release vẫn là draft/not effective. Audit live trước đó phát hiện cookie contradiction và thiếu provider/retention chính xác; không publish draft theo URL field populated. Cần reconcile đúng hành vi cuối và Owner review.

## 7. Phạm vi tự động đã được duyệt và Owner Gates

ĐƯỢC: sửa nhánh release, đọc source/metadata, QA synthetic đã duyệt, cập nhật PR62/docs; làm song song có phân quyền file, một emulator cục bộ và một fixture cloud tại một thời điểm.

Chỉ dùng demo-idogs-deletion hoặc idogs-app-staging/DB idogs-deletion-qa, bucket QA hiện có, Stripe TEST và disposable nonce/manifest workflow hiện có. Named idogs-deletion-ledger-qa hiện CHỈ là database emulator trong runner/máy local, không phải quyền tạo cloud DB.

KHÔNG tự động: deploy/promote/rollback; sửa dữ liệu/cấu hình Production; publish Privacy; gửi App Review; đổi IAM/credentials/provider; lấy/xuất secrets; gửi email/SMS/người khác/simulation; tạo thêm tài nguyên cloud. Những việc này phải có direct-chat review của bản cụ thể và Owner Gate tương ứng.
Có báo cáo lịch sử đã gửi human-email QA trong đợt được duyệt riêng; KHÔNG suy rộng thành quyền gửi lại trong scope hiện tại.

Giữ runtime/UID/revision/policy/manifest/content/generation/etag/lease guards. Không bỏ chốt để test PASS.
Nếu fail sau mutation: giữ original job/manifest/files/Auth/evidence và diagnose trạng thái thật; không dispatch mới hoặc cleanup mù.
Đăng nhập thiếu chỉ chặn portal tương ứng, không chặn công việc độc lập.

## 8. Bằng chứng QA mới nhất và giới hạn

Runtimee74bc49ab002309ad2dede6aa1e031e2207af42f:
- Push CI40983053423, PR CI40983058451: SUCCESS.
- Pinned emulator40983053426:131/131 actual SDK cases =112core+9schema+10outbox.
-480 unit tests, TypeScript/Vite build PASS.
- Cloud40983053462/job123827494746:SUCCESS, updated2026-10-30T01:04:44Z =30/10 lúc11:34:44Adelaide.
- controlledRecordRestoreBlocked:true; exactRecordReplayVerified:true; boundedRenewalQueueVerified:true; durableRenewalDispatchVerified:true; storageCreateOnlyCasVerified:true.
- storageCasProbePending:false; cleanupVerified:true; productionReady:false.
- emailSimulationRequested:false; emailSimulationSent:false; humanEmailSent:false.
- Human-inbox40983053432 và unchanged TestFlight40983053459 SKIPPED.
- Docs-only HEADee77e1ec đã có CI40983821308/40983816736 SUCCESS; không cần chạy lại cloud vì docs đổi.

Các increment đã làm:
- Disabled renewal tasks và private accepted-customer binding, per-task executor/receipts/retry/idempotency/epoch lease; explicit bounded queue max50targets,10/page, không global scan/arbitrary tasks.
- Metadata ingress/resume với precise createdAt/identity và owner/version guards.
- Storage single-send private zero-retry client, immutable intent/path reservation, generation/content readback; pending/dropped replies giữ hold. Emulator không enforce create-only CAS; chỉ actual Google412 là provider capability proof.
- Signed issuers giữ original active hold sau return/error/expiry; chưa có actual authorization/in-flight drain completion.
- Separate LOCAL independent acceptance/completion chain và quarantine, actual historical-Auth-import write rejection; không global completeness/cloud durability/ordinary-account admission.
- Intake: consent-bound prepared -> dispatching trước source send; source request+active barrier atomically; exact receipt/ACK readback mới đóng đúng lease. Unknown source absence không resend. Prepared-only explicit withdrawal có durable terminal receipt; dispatched cancellation vẫn hold.
- Root dog map collision đã sửa; descendant unsupported giữ unclassified review, chưa có full disposition/inventory/replay.
- No-send outbox: capture verified synthetic example.invalid recipient trước Auth removal sau source barrier; private receipt, completion/source chain/Authabsence recheck. Missing private history sau closed barrier không tái tạo. completion_bound_no_send chỉ historical proof, không transport/delivery-ready/delivered.
- Recipient retention/access/encryption/operational delivery và continuous restore admission vẫn cần thiết kế/review; không xem prototype là live confirmation.

Máy local đã gặp JVM/Node native memory exhaustion. Không bỏ test hoặc giảm guard; CI đã cung cấp actual131 proof. Đừng lặp npx/emulator mù nếu máy vẫn thiếu bộ nhớ. Diagnostics nằm trong release-audit-20261030/intake-withdrawal-local.
Older fd2779c7 concurrency failure và predecessor ledger transaction root cause chưa chốt; giữ assertions/diagnostics, không gọi fixed chỉ vì lần sau PASS.

## 9. Hai bài cloud không được trộn lẫn

### Managed database backup rehearsal — ĐÃ HOÀN TẤT
Final run40671427781/job122758889604/finalmanifest40671427781, source1fa8549b0f4aa145bdd686bc68f6726d2009eb75.
Actual managed restore/quarantine/replay/cleanup PASS; hai DB, backup và schedule thử đã dọn.
KHÔNG rerun prepare/continue/restore/replay, KHÔNG tạo lại hai DB/backup/schedule.
Grant IAM tạm đã hết2026-10-29T06:24:03Z; không gia hạn.
Original failed fixture40843318324 được recovery đúng một lần40845405102, rồi fixed cloud40845752578 PASS. Không chạy deletion-renewal-recover.yml lại.
Historical GitHub artifact là historicalOnly/freshness-unverified, không phải current live ledger authority.

### Original Storage7ngày — CHƯA ĐẾN HẠN KIỂM CHỨNG
- Run40271208201; original job121405052447.
- Exact sourcee8dc2b1471397885502c7c13389d73f038813a70.
- Durable session master: idogs-app-staging / named DB idogs-deletion-qa / accountDeletionJobs/retention-session-40271208201.
- Original manifest/UID/generations/hardDeleteTime nằm trong session master. Không seed lại, không sửa source hoặc manifest, không tạo session khác.
- Initial setup SUCCESS có waiting_for_cloud_expiry, KHÔNG phải seven-day PASS.
- Deadline thật:2026-11-02T04:56:11.242Z =02/11/2026 lúc15:26:11Adelaide.
- Chỉ SAU deadline mới rerun ĐÚNG original job, giữ run ID/source. workflow_dispatch mới tạo fixture khác, bị cấm.
- Trước rerun kiểm tra đúng source/master/manifest, không có original job đang chạy và chưa có actual postdeadline PASS.
- Final proof cần actual bounded soft-deleted inventory empty, exact known generations normal/soft reads404, không live copy, actual worker Auth removal và QA completion receipt.
- Không fake time, shorten protection, fixture thay thế hoặc gọi timer là bằng chứng.
- Production database backup expiry là chốt khác, không suy ra từ Storage deadline này.

## 10. Automations đang ACTIVE — tránh hai dev chạy trùng

Đã đọc automation.toml tại lúc bàn giao:
1. idogs-ti-p-t-c-nh-nh-ph-t-h-nh-v-qa: hourly engineering/QA, ACTIVE.
2. idogs-storage-7-ng-y-ng-y-2-11: bounded một lượt ngày02/11 lúc16:00Adelaide, ACTIVE.
Cả hai gắn chat01a17815-0936-7041-b483-452c26112e2a.
Automation configs ở C:/Users/Tom/.codex/automations/<id>/automation.toml. Chỉ đọc để kiểm tra; sửa lịch qua công cụ automation của app.

Lịch Storage đã được CREATE và read back thật, không phải đề xuất chưa lưu. Prompt yêu cầu exact original job và chống chạy trùng.
Khi dev/chat khác nhận quyền điều phối, Owner cần phối hợp chuyển/điều chỉnh lịch cũ qua công cụ app trước khi tạo lịch mới hoặc chạy cùng fixture. Tài liệu này KHÔNG pause lịch và không tự tạo automation thứ ba.
Không coi tick lịch hoặc thời gian đã trôi là QA PASS; kiểm tra commit/run thật.

## 11. Việc tiếp theo, theo thứ tự có thể làm song song

A. Read-only inventory: source c0bd0112496745435bccebf965308b53796c4dfa đã khôi phục buyerContacts ownerUid query có trên Production. REVIEW_ONLY_COLLECTIONS giữ unknown retention/disposition review kể cả contact liên kết owned dog; không thêm KNOWN hoặc quyền xóa. Test kiểm tra đúng owner, không xuất nội dung email, actual worker hold/preservation, bounded truncation và disposition precedence. Đọc deletion-buyer-contact-inventory-20261030.md để lấy kết quả exact-source mới nhất; không dùng proof131 cũ thay cho source này.

B. Bounded puppyProfiles/puppyFollowers/finance inventory và preservation/restore proof: authorship, current/former owner, descendants dưới parent absent, shared/cross-dog media, follower relation và tài chính. Root collision fix đã xong, đừng lặp lại.

C. Per-route authority/write freeze: purpose-aware signed grant issuance/confirmation và actual authorization/in-flight drain; transfer source/destination locks + dog version trong transaction; verified Stripe webhook resolver đặt SAU signature/event binding; cron resolver có per-account proof. Không dùng prototype anonymous global users query làm live resolver.

D. Terminal reconciliation cho dispatched cancellation/unknown source outcomes bằng original durable evidence. Không auto-unlock theo status/time/absence; không reconstruct independent authority từ restored source.

E. Operational recovery ledger/generation admission và no-send outbox follow-up: capture/binding prototype đã xong, nhưng cloud durability/authority, provider acknowledgements, recipient retention/privacy và actual transport chưa có. Không tự tạo cloud ledger/IAM hay gửi thử để đóng chốt.

F. Song song chuẩn bị selective Production-compatible candidate và App Store/Privacy/reviewer packet. Đọc lại Production baseline trước assembly; giữ newer business features. Portal labels/legal/reviewer login chỉ cần Owner nếu thật sự không tiếp cận được và đã có bản cụ thể để kiểm tra.

G. Storage exact-job check đúng hạn; nó không làm A–F phải chờ và không tự hoàn tất các gate khác.

Không hỏi Owner duyệt từng batch kỹ thuật đã thuộc scope. Không làm build iOS mới cho backend/docs-only changes. Không dừng chỉ để báo cáo; chỉ thông báo tiến triển quan trọng, hoàn tất hoặc lỗi/Owner Gate thật.

## 12. Chạy và kiểm tra

Trên clone riêng với node_modules bình thường: npm ci; npm test; npm run build.
Trên worktree hiện tại: kiểm tra junction trước; có thể tái dùng dependency sẵn có, chạy node node_modules/typescript/bin/tsc --noEmit.

Các workflow hiện có:
- deletion-processor-prototype.yml:480 unit/build/contracts + actual emulator.
- deletion-cloud-permanent.yml: scope/provider/contracts + shared emulator TRƯỚC actual cloud fixture. Emulator fail phải chặn cloud mutation.
- mobile-ios-store-readiness.yml: GET-only; không cần chạy lại khi metadata/script không đổi.
- mobile-ios-testflight.yml: signing/upload; giữ separate binary gate.
- deletion-retention-lifecycle.yml: chỉ original retention job continuation theo mục9.

Shared emulator command dưới đúng env/loopback/project đã được guard:

    node --test --test-concurrency=1 scripts/test-deletion-processor-emulator.mjs scripts/test-deletion-production-schema-emulator.mjs scripts/test-deletion-completion-outbox-emulator.mjs

Dùng một runner, không chạy các file này song song vì có inventory/cleanup scopes. Firestore/Auth/Storage emulator endpoints và ACCOUNT_DELETION_MODE=prototype-emulator,GCLOUD_PROJECT=demo-idogs-deletion phải đúng. Node22/Java21/firebase-tools14.12.0 khớp CI.
Không export CI secrets về local để chạy cho tiện. Tests mới có runtime change thì kiểm chứng exact-source; docs-only không lặp cloud/emulator đã PASS.

## 13. Đọc tài liệu theo thứ tự

Trong repo docs/release:
1. DEV-HANDOFF-IDOGS-20261030.md (tài liệu này).
2. selective-integration-plan-20261030.md; production-reconciliation-20261029.md.
3. deletion-dog-path-scope-20261030.md; deletion-completion-outbox-20261030.md.
4. deletion-intake-publication-20261030.md; deletion-current-ledger-20261030.md; deletion-ledger-provenance-20261030.md.
5. deletion-renewal-dispatch-20261029.md; deletion-document-ingress-20261030.md; deletion-storage-ingress-20261030.md; deletion-signed-authority-20261030.md.
6. deletion-restore-gate-20261028.md; deletion-retention-clock-20261026.md; app-store-preflight-20261030.md.

Ngoài repo tại workspace: RELEASE-PARALLEL-EXECUTION-20261030.md, DELETION-AUTO-CONTINUATION-20261029.md, DELETION-DOG-PATH-OUTBOX-20261030.md, RELEASE-AUDIT-20261029.md và IOS-CONSOLIDATED-OWNER-GATE-20261027.md. Gói ZIP bàn giao kèm bản copy các ghi chú chính.
Journals có đoạn pending cũ; phần Exact-source verification cuối và source hash mới hơn mới là trạng thái chốt. Không lấy đoạn lịch sử làm lệnh rerun fixture đã hoàn tất.

## 14. Điều kiện mới được coi là phát hành xong

Không chỉ tăng test count. Cần candidate dựa trên live baseline không làm mất feature, actual live deletion/renewal/ingress/recovery/communication hoạt động dưới authority được duyệt, Privacy hiệu lực đúng hành vi, listing/reviewer checks đầy đủ, Owner Gate của external changes và App Review thật sự được gửi/Apple chấp thuận.
Không cam kết02/11 là ngày public. Đó là ngày kiểm chứng một chốt Storage. Thời điểm Apple review không được kiểm soát bởi dev.

Gói bàn giao không chứa secret, browser cookie, reviewer login, .env, signing material, node_modules hoặc full repo snapshot. Code chuẩn lấy từ GitHub nhánh release; credential giữ ở nơi quản lý hiện có.
