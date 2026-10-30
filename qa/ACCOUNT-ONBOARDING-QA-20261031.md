# QA hoàn tất email/mật khẩu và chuyển tiếp khách OTP cũ

Branch: `feature/account-onboarding-recovery-20261031`. Tiếp sau recovery emulator `e0bbec36` đã được owner QA PASS. Đây là QA riêng, chưa kích hoạt/deploy Production hoặc cloud QA đang dùng.

## Owner QA trên máy đang chạy Codex

Link: http://127.0.0.1:5194/qa/onboarding

1. Chọn **Open phone account demo**. Đây là tài khoản giả có sẵn ở giai đoạn sau OTP; không tạo một UID mới. Màn hình quản lý phải chuyển sang **Keep your account secure**.
2. Nhập email giả, ví dụ `my-dog@example.invalid`, và mật khẩu thử nghiệm từ 8 ký tự. Không dùng email/mật khẩu thật. Chọn **Save email and send verification**.
3. Mở **Open simulated email inbox (local QA)**. Trong tab inbox chọn **Open simulated email inbox**, mở **Verify test email** và xác minh trong trang emulator. Không có email thật được gửi.
4. Quay lại tab hoàn tất tài khoản, chọn **Check or resend verification email**, sau đó **I've verified — continue**. Nếu chưa xác minh, không được vào quản lý.
5. Nhập lại mật khẩu thử nghiệm đã tạo và chọn **Save and continue**. Tới trang **Your account is ready**, chọn **Check saved dog and plan**: dog vẫn là **Ruby demo**, plan vẫn là **plus**.
6. Dùng tab Sign in để đăng nhập lại bằng chính email/mật khẩu thử nghiệm. Tài khoản, dog và plan phải giữ nguyên.

QR công khai: http://127.0.0.1:5194/p/ONBOARDING-DEMO — phải xem được **Ruby is enjoying the garden** trước khi hoàn tất tài khoản; không được thấy **Private breeder note**.

Link chỉ hoạt động trên máy này khi emulator/server đang chạy. Recovery QA đã PASS vẫn là http://127.0.0.1:5193/forgot-login-email và dùng dự án/cổng riêng. Không dùng link localhost trên iPhone khác máy.

## Luồng đã xây

- Phone-only → link email + password bằng `linkWithCredential` trên đúng Firebase User → gửi email verification ngay → xác minh email → reauthenticate bằng email/password → server chứng minh mật khẩu thật → mở quản lý.
- Không dùng `verifyBeforeUpdateEmail` cho tài khoản phone-only: emulator đã phát hiện `auth/missing-email` ở cách cũ. Luồng mới tránh lỗi đó, không xoá/tạo lại/gộp Auth identity.
- Với email/password đã tồn tại, chỉ xác nhận mật khẩu. Không âm thầm thay mật khẩu sau OTP. Nếu tài khoản trước đây chỉ dùng email-link, dùng Firebase password reset qua mailbox đã xác minh để thiết lập mật khẩu trên UID đó.
- Login email/password vẫn là mặc định. Khi QA gate bật, login chính xác nhận readiness một lần nếu còn thiếu; khi đã có proof hợp lệ thì không lặp password-proof REST không cần thiết.
- Giữ đường **Existing mobile account** cho khách OTP cũ. OTP session không mở thẳng phần quản lý, kể cả khi đã hoàn tất trước đây: phải xác nhận mật khẩu chính. Các tài khoản khác dùng email riêng; không merge theo số contact trên profile.
- Giữ destination nội bộ hoặc QR/follow an toàn qua completion. QR route nằm ngoài gate; view public qua API vẫn hoạt động khi tài khoản đang đăng nhập nhưng chưa hoàn tất. Các action quản lý không được dùng fallback public.

## Kiểm tra máy chủ và quyền

- `verifyAccountToken` được nối vào các entry point quản lý hiện có (45 import sites, gồm helper finance/admin). Gate chỉ hoạt động khi `IDOGS_ACCOUNT_ONBOARDING_GATE=1`; project ngoài staging/demo bị từ chối. Không đặt flag trên Production.
- Gate yêu cầu token còn hiệu lực/chưa bị revoke, session chính `password`, user chưa disabled, email hiện tại verified, provider password và record server-only `accountReadiness/{uid}` đúng UID/email/creation time/version.
- Không tin `providerId=password` đơn lẻ vì email-link cũng có provider đó. `POST /api/account-onboarding` chứng minh mật khẩu bằng Firebase Auth `signInWithPassword`, kiểm tra UID khớp tài khoản đang đăng nhập, recent authentication, đọc lại trạng thái Auth/deletion, rồi mới lưu readiness. Không nhận email/UID/ready flag từ client để ghi proof.
- Password-proof bị giới hạn 5 lần/UID/15 phút; không lưu/log password hoặc token. API không cache và không trả raw Auth/provider errors.
- Readiness áp dụng nhất quán cả khi người dùng unlink phone, tránh bỏ phone để bỏ qua gate. Khách email hiện tại dùng primary login để chứng minh cùng tài khoản; không có migration dữ liệu hay UID.
- Prototype Firestore rules được sinh riêng ở `qa/onboarding.firestore.rules.local`. File rules dùng Production không đổi. Các schema/ownership/billing validators cũ được giữ lại. Own-profile read/bootstrap create vẫn có để đăng ký không bị deadlock; trước readiness chỉ cho sync trường email khớp email verified trong token. Các update quản lý và private dog reads bị chặn.
- Client không được đọc/ghi readiness hoặc giả cờ để vượt gate. Storage direct-client vẫn deny-all theo policy cũ; trusted upload/document endpoints được nối vào cùng API gate.
- Ngoại lệ có chủ đích: account-deletion lifecycle, hỗ trợ khách hàng đã xác minh email, welcome delivery và các API QR/landing công khai. Không khoá đường hỗ trợ/xoá tài khoản khi cần hoàn tất setup. Các kiểm tra quyền cũ của từng API vẫn giữ nguyên.

## Kết quả đã kiểm chứng

- TypeScript/build local PASS; 68 files / **545 regression tests PASS**.
- **8 Auth + Firestore emulator integration tests PASS**: phone signin đúng UID cũ; email conflict không merge; chưa verified không ready; email verified chưa đủ nếu chưa chứng minh mật khẩu; email-only sync không mở quyền quản lý; password confirmation/reset giữ UID/dog/subscription markers; signin lại bằng email giữ dữ liệu; OTP session sau migration vẫn phải xác nhận password; public GET/POST QR feed chỉ thấy public update; unlink phone không bypass; đổi email/disabled làm readiness mất hiệu lực.
- Kiểm thử service và UI có session switch, conflict, delivery failure giữ account, unverified email, gate fail-closed, flag-off compatibility và original QR destination. Follow từ QR đi qua setup khi cần, rồi giữ ý định Follow đúng puppy; chọn Keep browsing bỏ auto-follow để không mắc vòng lặp setup.
- Integration dùng subscription/Stripe customer **dữ liệu giả**, không phải kiểm tra hay thay đổi subscription Stripe thật.
- Phạm vi trình duyệt: demo post-OTP → bị chặn vào completion, bố cục form và public QR. Người dùng thực hiện phần nhập mật khẩu thử nghiệm/xác minh mailbox trong owner QA; không đánh dấu full browser/iPhone/SMS thật PASS thay owner.

## Giới hạn và trước production

Chưa kiểm tra end-to-end từng nghiệp vụ quản lý trên cloud với gate bật, SMS/email delivery thật, Safari iPhone hay quota/get-call budget của mọi query trong rules prototype. Firebase token/rules có giới hạn freshness thông thường; API đọc lại Auth hiện tại, còn rules dùng claims của token và readiness document. Cần review triển khai/revocation cho rollout thực tế.

Source audits được cập nhật để lần theo shared verifier tới Firebase SDK và readiness gate, thay vì chỉ tìm tên hàm cũ. Audit private-dog redirect cũng kiểm shared safe app/QR policy mới; verify/reset vẫn giữ nguyên QR/follow destination và chặn external redirects. Ngoài các kiểm tra CI bắt buộc, audit landing-media cũ còn 6 lỗi kỳ vọng markup/video-limit và audit showcase-fix-round cũ còn 1 lỗi kỳ vọng compressed-upload path trên các feature không đổi trong task này. Không tính hai suite đó là PASS; không sửa nghiệp vụ landing/upload để ép các kỳ vọng cũ qua.

Thêm kiểm tra Auth/readiness làm tăng request/read: API gate đọc Auth user + readiness; rules có thể thêm một read readiness theo request/cache của Firestore. Password proof thêm một Auth REST verification và các ghi proof/rate-limit. Chưa chốt chi phí cloud; không thay billing/subscription hay nâng Identity Platform.

Production vẫn giữ email/password + SMS configuration hiện tại. Bản staging inspection cũ cho thấy email-link còn enabled; subtype/config không bị đổi trong build này. Server gate hiện từ chối project production ngay cả khi vô tình bật flag. Muốn rollout phải duyệt riêng code/config/rules, QA cloud và rollback, không merge toàn branch QA vào production một cách tự động.

## Dev chạy lại

```powershell
node scripts/prepare-onboarding-rules.mjs
$env:GCLOUD_PROJECT='demo-idogs-account-onboarding'
firebase emulators:exec --config firebase.account-onboarding-qa.json --project demo-idogs-account-onboarding --only auth,firestore 'node --test scripts/test-account-onboarding-emulator.mjs'
```

Để mở UI thay command test bằng `node scripts/run-account-onboarding-qa.mjs`. Server bind 127.0.0.1:5194, Auth 9399, Firestore 9380; hub/logging và HMR cũng tách khỏi recovery QA. Dữ liệu mất khi dừng emulator. Generated rules và source query scan là `.local`, không deploy hoặc commit như production rules.

Tệp chính: `api/_lib/account-onboarding.js`, `api/account-onboarding.js`, `src/lib/accountOnboarding.ts`, `src/components/ui/AccountSetupGate.tsx`, `src/pages/CompleteAccountPage.tsx`, `scripts/prepare-onboarding-rules.mjs`, `scripts/test-account-onboarding-emulator.mjs`. CI workflow riêng chạy prototype rules và synthetic integration không dùng cloud credentials.
