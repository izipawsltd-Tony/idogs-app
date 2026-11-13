# Control Center — định nghĩa funnel (Owner chốt 13/11/2026)

Trạng thái: **đã chốt định nghĩa, đang thử trên staging**. Chỉ đọc dữ liệu đã có. Không ghi dữ liệu mới, không thêm công cụ analytics, không đổi quy tắc Firestore. Lịch giám sát chính thức chưa bật.

Mã: `api/_lib/control-center-growth.js` (khối `funnel`), `api/_lib/control-center-payments.js` (lịch sử thanh toán Stripe, chỉ đọc), `api/_lib/control-center-evidence.js` (phần gửi cho Claude), `src/super-admin/pages/SuperAdminAiCeoPage.tsx` (mục "Funnel · last 30 days").

Quy tắc chung: tài khoản INTERNAL và TEST_QA bị loại. LIKELY_REAL không phải khách đã xác nhận. Thiếu dữ liệu thì hiện "No data yet" (chưa có dữ liệu), không bao giờ hiện 0.

## 1. Lượt ghé trang

- **Định nghĩa:** số phiên truy cập có trang đăng ký, lấy từ một nguồn analytics đã xác minh. Tỷ lệ truy cập → đăng ký = số đăng ký đủ điều kiện / số phiên đó.
- **Hiện tại:** chưa có nguồn analytics đủ tin cậy, nên hiện "No data yet" và **để trống tỷ lệ** (`status: NO_VERIFIED_SOURCE`). Không dùng Meta Pixel hay số liệu tự ghi nhận nguồn để thay thế.
- **Còn thiếu:** chọn và xác minh một nguồn analytics (việc riêng, cần Owner duyệt, có thể ảnh hưởng Chính sách quyền riêng tư).

## 2. Kích hoạt

- **Định nghĩa:** tài khoản tạo thành công hồ sơ chó đầu tiên, vào hoặc sau thời điểm đăng ký.
- **Mốc riêng:** tạo lứa đầu tiên sau đăng ký (tính cả lứa đã lưu trữ).
- **Giới hạn của dữ liệu cũ:** chỉ đếm hồ sơ **còn tồn tại**. Chó/lứa đã xoá không được tính. Chó đã chuyển nhượng sang tài khoản khác chỉ được tính cho tài khoản gốc nếu bản ghi còn gắn tài khoản gốc. Dashboard ghi rõ giới hạn này.
- **Đo được ngay:** có.

## 3. Khách trả phí

- **Định nghĩa:** tài khoản có giao dịch thanh toán thành công đã xác minh, gắn được với đúng một tài khoản iDogs. Tính **mỗi tài khoản một lần**, theo ngày thanh toán đầu tiên đã xác minh. Tính cả Stripe và Apple khi xác minh được.
- **Stripe (đã làm):** đọc lịch sử charge của từng Stripe customer gắn với tài khoản (`stripeCustomerId`). Chỉ tính charge thành công, đã thu tiền, lớn hơn A$0, không bị hoàn tiền toàn bộ, ở **chế độ LIVE**. Voucher miễn phí, khuyến mãi A$0 và giao dịch thử nghiệm không tính. Một Stripe customer gắn với nhiều tài khoản thì không quy cho ai, và số liệu chuyển sang PARTIAL.
- **Chỉ chứng nhận số liệu khi:** khoá Stripe là LIVE, đọc được hết mọi customer và không có danh sách bị cắt. Nếu không, hiện "No data yet" kèm lý do (`TEST_MODE_ONLY`, `PARTIAL`, `UNKNOWN_MODE`, `UNAVAILABLE`).
- **Apple:** ứng dụng iOS hiện **không bán** gói qua In-App Purchase (khách mua trên web rồi dùng trong app), nên không có giao dịch Apple để xác minh. Dashboard ghi rõ: "Stripe only".
- **Staging:** khoá Stripe là test mode, nên số liệu khách thật luôn để trống. Để kiểm thử, dashboard hiện riêng dòng "Test-mode diagnostics (never customer results)". Dòng này không bao giờ gửi cho Claude.

## 4. Giữ chân

Hai chỉ số tách riêng. **Ưu tiên chỉ số trả phí** cho mục tiêu tăng khách trả tiền.

- **Giữ chân trả phí (đã làm):** trong nhóm tài khoản đã đến kỳ gia hạn (kỳ trả phí đầu tiên đã kết thúc ít nhất 3 ngày), tỷ lệ có gia hạn thành công. Dùng cùng điều kiện LIVE/đầy đủ như mục 3.
  - "Gia hạn thành công" = một hoá đơn **kỳ tiếp theo** (`subscription_cycle`) đã trả, lớn hơn A$0, của **cùng thuê bao** với hoá đơn trả phí đầu tiên. Đăng ký lại thuê bao mới sau khi huỷ, thuê bao khác của cùng khách, và hoá đơn nâng/hạ gói giữa kỳ **không** tính là gia hạn.
  - "Đến kỳ" tính theo ngày hết kỳ dịch vụ của thuê bao trên hoá đơn đầu tiên. Dòng điều chỉnh giá giữa kỳ (proration) không dùng để tính ngày.
  - Hoá đơn A$0 (khuyến mãi, voucher) không phải kỳ trả phí: nếu khách được miễn phí rồi mới trả, kỳ trả phí đầu tiên là hoá đơn có tiền đầu tiên.
  - Không xác định được thuê bao hoặc ngày hết kỳ thì không đưa vào mẫu số (ghi là `unknownPeriod`).
- **Giữ chân sử dụng (chưa đo):** tài khoản quay lại thực hiện thao tác có ý nghĩa trong app (thêm/sửa chó, hồ sơ sức khoẻ, nhắc lịch, tài liệu, lứa). Dashboard hiện "Not measured". Cần chốt cửa sổ thời gian và nguồn dữ liệu hoạt động trước khi đo.

## Đo được / còn thiếu (13/11/2026)

| Chỉ số | Production (khi lên) | Staging hiện tại |
| --- | --- | --- |
| Lượt ghé trang, tỷ lệ → đăng ký | Chưa có dữ liệu (chưa có nguồn) | Chưa có dữ liệu |
| Kích hoạt (chó đầu tiên) | Đo được, chỉ hồ sơ còn tồn tại | Đo được |
| Lứa đầu tiên | Đo được, chỉ hồ sơ còn tồn tại | Đo được |
| Khách trả phí mới / tổng | Đo được từ Stripe LIVE; Apple không có | Không đo được (test mode); có dòng chẩn đoán test |
| Giữ chân trả phí | Đo được từ Stripe LIVE | Không đo được (test mode); có dòng chẩn đoán test |
| Giữ chân sử dụng | Chưa đo | Chưa đo |

## Kiểm thử

`scripts/control-center-payments.test.mjs` (thanh toán thành công/thất bại/hoàn tiền/A$0, test mode, loại INTERNAL/QA, đọc lỗi, danh sách bị cắt, customer dùng chung, giới hạn số customer, gia hạn), `scripts/control-center-growth.test.mjs` (chó đầu tiên, lứa đầu tiên gồm cả lứa lưu trữ, không có nguồn lượt ghé, chỉ hiện số trả phí khi VERIFIED), `scripts/control-center-evidence.test.mjs` (Claude chỉ nhận số đã xác minh, không nhận dòng chẩn đoán test), `SuperAdminAiCeoPage.test.ts` (hiển thị "No data yet", nhãn test mode, số gia hạn).
