# QA “Quên email đăng nhập?” — 31/10/2026

Owner đã duyệt xây QA/emulator bằng SMS giả trong chat. Chưa duyệt SMS thật, chi phí mới, Identity Platform hoặc thay cấu hình/deploy Production.

## Link và cách thử

Mở trên chính máy đang chạy Codex: http://127.0.0.1:5193/forgot-login-email

Link chỉ hoạt động khi local QA server/emulator còn chạy; không dùng link này trên iPhone/máy khác. Không nhập số điện thoại hoặc thông tin tài khoản thật.

| Tình huống demo | Số giả | Mã giả | Kết quả mong đợi |
| --- | --- | --- | --- |
| Tài khoản có email đã xác minh | 0400000201 | 123456 | Chỉ sau khi mã đúng mới hiện `qa-owner@example.invalid`; chưa đăng nhập vào tài khoản |
| Mã sai | 0400000201 | 000000 | Báo không xác minh được, không hiện email; có thể thử mã đúng trước khi hết hạn/đủ 5 lần sai |
| Tài khoản chưa hoàn tất email | 0400000202 | 123456 | Hướng dẫn quay lại tài khoản mobile hiện tại để hoàn tất; không tạo tài khoản mới |
| Số chưa liên kết | 0400000299 | 123456 | Thông báo ban đầu giống nhau; bước xác minh thất bại, không hiện email và không tạo Auth user |

Sau một yêu cầu cần đợi ít nhất 60 giây trước khi yêu cầu mã mới cho cùng số. OTP hết hạn sau 5 phút; tối đa 5 lần thử. Bản demo dùng mã cố định chỉ trong dự án emulator giả; cơ chế dịch vụ được test với mã ngẫu nhiên an toàn. Không có SMS thật.

## Đã xây

- UI riêng `/forgot-login-email`, dùng cùng bố cục đăng nhập iDogs. Link truy cập xuất hiện ở màn hình login khi chạy local QA.
- API QA `POST /api/account-recovery` với `action=start` hoặc `action=verify`.
- Mỗi mã gắn với challenge ngẫu nhiên, số điện thoại, UID ban đầu, thông tin thu hồi phiên và ràng buộc thiết bị/IP của yêu cầu.
- Lưu HMAC có khóa của OTP, không lưu mã rõ trong Firestore. Mã dùng một lần; tăng số lần thử và tiêu thụ mã bằng transaction.
- Giới hạn phía server: 5 yêu cầu/số/ngày, 20/IP/giờ, 10/device/giờ, 100 yêu cầu toàn cục/ngày; giãn gửi 60 giây. Bước verify cũng có giới hạn IP/device/toàn cục.
- Chỉ tra số được liên kết trong Firebase Auth, không tra số liên hệ trong profile. Số lạ không tạo Auth user. Không mint login token, reset mật khẩu, đổi số, gộp tài khoản hay thay dữ liệu/subscription.
- Kiểm tra lại mapping, disabled, thay đổi thời điểm thu hồi phiên và account deletion sau khi chứng minh OTP.
- Responses không cache; mã và email không đưa vào URL, browser storage hoặc analytics. Lỗi gửi tin không tự retry.
- Firestore rules hiện tại được nạp vào emulator; client ẩn danh và client đã đăng nhập đều bị từ chối đọc/ghi challenge và bộ đếm giới hạn.

## Kết quả và giới hạn

- 16 kiểm thử integration recovery PASS trên Auth + Firestore emulator; 4 integration đổi số PASS.
- 6 kiểm thử UI recovery PASS; full regression 63 files / 522 tests PASS; typecheck và build local PASS.
- Đã thử trình duyệt UI → API → emulator → hiện email demo; mã sai không hiện email, mã đúng mới hiện email. Kiểm tra viewport 390px không có tràn ngang. Đây không phải kiểm tra SMS/Safari thật trên iPhone.
- Handler được deploy thông thường luôn trả 503; không thể bật gửi tin thật bằng client flag. Factory recovery từ chối môi trường ngoài demo/loopback và transport không đánh dấu giả. Không thay cấu hình Firebase Production hay QA cloud.
- QA này chứng minh recovery giả; CHƯA phải PASS toàn bộ nâng cấp account onboarding/migration. Các phạm vi khác trong `ACCOUNT-AUTH-OWNER-GATE-20261031.md` vẫn cần build/QA riêng.

## Trước khi có thể mở recovery thật

Chưa có transport SMS thật, CAPTCHA/App Check, cấu hình proxy/IP tin cậy cho cloud, thử chống timing/enumeration thực tế, TTL/retention vận hành, báo động chi phí, giá sender/SMS được xác nhận hoặc ngân sách được owner duyệt. Bộ đếm giả lập theo số lần yêu cầu không phải sổ chi phí SMS tiền thật. Không public mã cố định, fake SMS inbox hay fake-code adapter với dữ liệu thật.

Phải xác nhận nhà cung cấp/giá, review an toàn, bổ sung các phần trên và có owner gate riêng trước live pilot. Chưa nâng cấp Identity Platform, mua dịch vụ, bật SMS thật hoặc deploy Production.

## Chạy lại cho dev

Trong branch `feature/account-onboarding-recovery-20261031`, cài dependencies ở checkout riêng. Cần Node và Java 21.

PowerShell (không dùng cloud credentials):

```powershell
$env:GCLOUD_PROJECT='demo-idogs-account-mobile'
firebase emulators:exec --config firebase.account-auth-qa.json --project demo-idogs-account-mobile --only auth,firestore 'node scripts/run-account-auth-emulator-tests.mjs'
```

Chạy UI QA (giữ tiến trình chạy trong lúc kiểm tra):

```powershell
$env:GCLOUD_PROJECT='demo-idogs-account-mobile'
firebase emulators:exec --config firebase.account-auth-qa.json --project demo-idogs-account-mobile --only auth,firestore 'node scripts/run-account-recovery-qa.mjs'
```

Server bind `127.0.0.1:5193`, Auth emulator `127.0.0.1:9299`, Firestore emulator `127.0.0.1:9280`. Không bật cấu hình này trên deployment cloud. Dữ liệu giả mất khi dừng emulator.
