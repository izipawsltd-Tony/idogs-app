# Control Center — định nghĩa funnel (Owner chốt 13/11/2026)

Trạng thái: **đã chốt định nghĩa, đang thử trên staging**. Chỉ đọc dữ liệu đã có. Không ghi dữ liệu mới, không thêm công cụ analytics, không đổi quy tắc Firestore. Lịch giám sát chính thức chưa bật.

Mã: `api/_lib/control-center-growth.js` (khối `funnel`), `api/_lib/control-center-payments.js` (lịch sử thanh toán Stripe, chỉ đọc), `api/_lib/control-center-evidence.js` (phần gửi cho Claude), `src/super-admin/pages/SuperAdminAiCeoPage.tsx` (mục "Funnel · last 30 days").

Quy tắc chung: tài khoản INTERNAL và TEST_QA bị loại. LIKELY_REAL không phải khách đã xác nhận. Thiếu dữ liệu thì hiện "No data yet" (chưa có dữ liệu), không bao giờ hiện 0.

## 1. Lượt ghé trang (cập nhật 19/11/2026)

- **Định nghĩa:** số phiên truy cập có trang đăng ký, lấy từ một nguồn analytics **đã được Owner duyệt**. Tỷ lệ truy cập → đăng ký = số đăng ký web đủ điều kiện / số phiên đó.
- **Mã:** `api/_lib/control-center-traffic.js`. Dashboard và Claude dùng chung kết quả này (Claude nhận qua danh sách trường cho phép trong `control-center-evidence.js`).

### Kiểm kê nguồn hiện có

| Nguồn | Đơn vị đếm | Phạm vi | Loại bot/test | Chống trùng | Dùng được? |
| --- | --- | --- | --- | --- | --- |
| `landingStats` (Firestore, `/api/landing-beacon`) | Lượt tải trang `/` hoặc `/signup`, theo ngày UTC | Chỉ lượt đến từ quảng cáo (có `fbclid` hoặc `utm_source`) | Không | Không (tải lại trang đếm 2 lần) | **Không**: không phải phiên, thiếu khách tự tìm đến, không lọc bot |
| Meta Pixel `PageView` | Sự kiện bên thứ ba | Chỉ sau khi khách bấm "Allow" | Do Meta | Do Meta | **Không**: thiếu người từ chối cookie, không có quyền đọc dữ liệu |
| `users.acquisition` | Tài khoản | Nguồn khách tự mang theo lúc đăng ký | Có (loại INTERNAL/TEST_QA) | Theo tài khoản | Chỉ cho tử số, không có mẫu số |
| Vercel Web Analytics | Lượt xem trang / khách | Toàn site | Có lọc bot | Theo khách | **Chưa bật** (thu thập mới, cần Owner duyệt và cập nhật Chính sách quyền riêng tư) |

Kết luận: **chưa có nguồn đạt yêu cầu**. Dashboard và Claude hiển thị **Unverified**, để trống số phiên và tỷ lệ.

### Quy tắc khi có nguồn

- **Cửa sổ:** đúng N ngày UTC trọn vẹn gần nhất đã qua 24 giờ chờ dữ liệu đến muộn (ví dụ lúc 10:00Z ngày 20/11, cửa sổ 7 ngày là 12–18/11). Dữ liệu ngày chưa qua 24 giờ không tính.
- **Môi trường:** nguồn và tài khoản phải cùng môi trường (preview với preview, production với production).
- **Đơn vị:** nguồn phải đếm `SESSION_WITH_SIGNUP_PAGE` và xác nhận đã loại bot và lưu lượng thử nghiệm.
- **Chống trùng:** một ngày báo hai lần cùng số thì gộp; khác số thì Unverified. Tài khoản trùng chỉ đếm một lần.
- **Đầy đủ:** thiếu ngày, số âm hoặc ngày chưa được nguồn chốt → Unverified.
- **Ghép:** ghép tổng theo cùng ngày và cùng môi trường, **không** ghép từng phiên. Tử số chỉ gồm đăng ký **web** (đăng ký trên app iOS không đi qua trang `/signup`). Tử số lớn hơn mẫu số → Unverified (lệch phạm vi).
- **Mẫu số 0:** báo 0 phiên, tỷ lệ để trống.
- Chỉ trạng thái **VERIFIED** mới hiện số phiên và tỷ lệ. Mọi trạng thái khác hiện "Unverified" kèm lý do.

### Còn thiếu để đo thật

1. Owner chọn và duyệt một nguồn phiên (ví dụ bật Vercel Web Analytics), rồi thêm mã nguồn vào `APPROVED_VISIT_SOURCES` trong một thay đổi có review.
2. Hồ sơ tài khoản hiện **không ghi nền tảng đăng ký** (web/iOS). Khi có nguồn, kết quả vẫn Unverified (`SIGNUP_PLATFORM_UNKNOWN`) cho tới khi tài khoản mới được ghi `signupPlatform`. Việc này cần Owner duyệt vì là trường dữ liệu mới.

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
  - "Gia hạn thành công" = hoá đơn `subscription_cycle` đã trả, lớn hơn A$0, của **cùng thuê bao** với hoá đơn trả phí đầu tiên, cho **đúng kỳ dịch vụ liền sau** kỳ trả phí đầu tiên (kỳ đó bắt đầu tại ngày hết kỳ đầu tiên, sai lệch tối đa 1 ngày). Đăng ký lại thuê bao mới sau khi huỷ, thuê bao khác của cùng khách, hoá đơn nâng/hạ gói giữa kỳ, và hoá đơn đã trả cho một kỳ **sau đó** khi kỳ liền sau bị bỏ qua, không trả hoặc A$0 đều **không** tính là gia hạn. Trả muộn (sau khi nhắc nợ) cho đúng kỳ liền sau vẫn tính.
  - "Đến kỳ" tính theo ngày hết kỳ dịch vụ của thuê bao trên hoá đơn đầu tiên. Dòng điều chỉnh giá giữa kỳ (proration) không dùng để tính ngày.
  - Hoá đơn A$0 (khuyến mãi, voucher) không phải kỳ trả phí: nếu khách được miễn phí rồi mới trả, kỳ trả phí đầu tiên là hoá đơn có tiền đầu tiên.
  - Không xác định được thuê bao hoặc ngày hết kỳ thì không đưa vào mẫu số (ghi là `unknownPeriod`).
- **Giữ chân sử dụng (chưa đo):** tài khoản quay lại thực hiện thao tác có ý nghĩa trong app (thêm/sửa chó, hồ sơ sức khoẻ, nhắc lịch, tài liệu, lứa). Dashboard hiện "Not measured". Cần chốt cửa sổ thời gian và nguồn dữ liệu hoạt động trước khi đo.

## Đo được / còn thiếu (13/11/2026)

| Chỉ số | Production (khi lên) | Staging hiện tại |
| --- | --- | --- |
| Lượt ghé trang, tỷ lệ → đăng ký | Unverified (chưa có nguồn được duyệt) | Unverified; logic đã kiểm thử bằng dữ liệu tổng hợp |
| Kích hoạt (chó đầu tiên) | Đo được, chỉ hồ sơ còn tồn tại | Đo được |
| Lứa đầu tiên | Đo được, chỉ hồ sơ còn tồn tại | Đo được |
| Khách trả phí mới / tổng | Đo được từ Stripe LIVE; Apple không có | Không đo được (test mode); có dòng chẩn đoán test |
| Giữ chân trả phí | Đo được từ Stripe LIVE | Không đo được (test mode); có dòng chẩn đoán test |
| Giữ chân sử dụng | Chưa đo | Chưa đo |

## Kiểm thử

`scripts/control-center-traffic.test.mjs` (bộ dữ liệu tổng hợp có kết quả định trước 100 phiên / 9 đăng ký web = 9,0%; trùng, đến muộn, mẫu số 0, thiếu dữ liệu, lệch phạm vi; dashboard và Claude cùng trạng thái, cửa sổ và số liệu), `scripts/control-center-payments.test.mjs` (thanh toán thành công/thất bại/hoàn tiền/A$0, test mode, loại INTERNAL/QA, đọc lỗi, danh sách bị cắt, customer dùng chung, giới hạn số customer, gia hạn), `scripts/control-center-growth.test.mjs` (chó đầu tiên, lứa đầu tiên gồm cả lứa lưu trữ, không có nguồn lượt ghé, chỉ hiện số trả phí khi VERIFIED), `scripts/control-center-evidence.test.mjs` (Claude chỉ nhận số đã xác minh, không nhận dòng chẩn đoán test), `SuperAdminAiCeoPage.test.ts` (hiển thị "No data yet", nhãn test mode, số gia hạn).
