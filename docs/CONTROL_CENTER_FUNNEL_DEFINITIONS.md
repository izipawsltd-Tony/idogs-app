# Control Center — đề xuất định nghĩa lịch sử funnel (chờ chủ hệ thống chốt)

Ngày 13/11/2026. Trạng thái: **ĐỀ XUẤT**. Chưa thu thập dữ liệu, chưa ghi gì vào Firestore. Chỉ bắt đầu viết mã thu thập sau khi chủ hệ thống chốt 4 quyết định ở cuối tài liệu.

## Vì sao cần

Dashboard hiện chỉ chụp trạng thái hiện tại. Nó không trả lời được: bao nhiêu người ghé trang, bao nhiêu người thanh toán lần đầu trong tháng này, và khách còn ở lại sau một tháng không. `processedStripeEvents` chỉ dùng để chống xử lý trùng webhook, không đủ để đếm chuyển đổi (một sự kiện có thể xử lý xong mà không đổi trạng thái tài khoản, và tài liệu này không giữ ngày thanh toán theo khách).

## Định nghĩa đề xuất

| Bước | Định nghĩa đề xuất | Nguồn được chấp nhận | Khóa chống trùng |
| --- | --- | --- | --- |
| Người ghé trang | Một trình duyệt mở trang công khai (trang chủ, đăng ký, trang lứa) trong một ngày theo giờ Adelaide. Không lưu email, IP hay ID tài khoản. | Cần chọn nguồn (quyết định 1). | ngày + mã ẩn danh của trình duyệt |
| Đăng ký | Hồ sơ `users/{uid}` được tạo **và** email đã xác minh. | Server (API tạo hồ sơ, xác minh email). | `signup:{uid}` |
| Kích hoạt | Tài khoản tạo hồ sơ chó đầu tiên trong vòng 7 ngày sau đăng ký (khớp điều kiện voucher: đã xác minh và có ít nhất 1 chó). | Server khi ghi `dogs`. | `activation:{uid}` |
| Thanh toán đầu tiên | Hóa đơn Stripe **chế độ LIVE**, trạng thái đã thanh toán, số tiền lớn hơn A$0, đầu tiên của khách đó. Voucher miễn phí, khuyến mãi A$0 và gói dùng thử **không** tính. | Webhook Stripe `invoice.paid` đã xác thực chữ ký. | `first_payment:{invoiceId}` |
| Giữ chân | Khách đã thanh toán lần đầu và có thêm một hóa đơn LIVE đã thanh toán ở kỳ kế tiếp (gia hạn thành công). | Webhook Stripe `invoice.paid`. | `renewal:{invoiceId}` |

Tài khoản INTERNAL và TEST_QA bị loại khỏi mọi tỷ lệ, như dashboard hiện tại. LIKELY_REAL không được tính là khách đã xác nhận.

## Cách lưu (khi được duyệt)

- Một bộ sưu tập riêng, ví dụ `controlCenterEvents/{khóa chống trùng}`. Ghi bằng `create()` nên một sự kiện gửi lại (webhook retry) không bị đếm hai lần.
- Mỗi sự kiện có: loại, thời điểm xảy ra theo nguồn (`occurredAt`), thời điểm server nhận (`receivedAt`), phân loại tài khoản tại thời điểm đó. Không lưu email, tên, số tiền chi tiết của từng khách ngoài mức cần cho tổng hợp.
- Tính funnel theo `occurredAt`, không theo `receivedAt`, nên sự kiện đến sai thứ tự vẫn đúng.
- Quy tắc Firestore: chỉ server ghi, chỉ Super Admin đọc tổng hợp. Thay đổi quy tắc là cổng G3 riêng.
- Xóa tài khoản: thêm bộ sưu tập này vào `api/_lib/account-deletion-inventory.js` trước khi bật, để yêu cầu xóa tài khoản xóa luôn sự kiện gắn với người đó.

## Kiểm thử bắt buộc trên staging (dữ liệu giả)

Sự kiện gửi trùng; sự kiện đến sai thứ tự; webhook retry sau lỗi; hóa đơn A$0 và voucher không thành thanh toán đầu tiên; hóa đơn TEST bị loại; xóa tài khoản xóa sự kiện; khoảng thời gian trước ngày bắt đầu thu thập hiển thị "chưa đủ dữ liệu" thay vì 0.

## Giới hạn cần nói rõ

Lịch sử chỉ có từ ngày bật thu thập. Không dựng lại quá khứ từ dữ liệu hiện có, trừ khi chủ hệ thống duyệt một lần nhập lại riêng từ Stripe (chỉ đọc).

## 4 quyết định cần chủ hệ thống chốt

1. **Nguồn đếm người ghé trang:** (a) Vercel Web Analytics — có sẵn trên Vercel, có thể tốn phí theo gói; hoặc (b) bộ đếm ẩn danh tự làm, gọi một API nhỏ khi trang tải. Cả hai cần kiểm tra lại Chính sách quyền riêng tư.
2. **Kích hoạt:** giữ "chó đầu tiên trong 7 ngày", hay đổi mốc khác (ví dụ thêm lịch tiêm đầu tiên)?
3. **Thanh toán qua Apple trên iPhone:** nếu sau này bán gói trong ứng dụng iOS, có tính vào "thanh toán đầu tiên" không (cần nguồn sự kiện riêng từ Apple)?
4. **Giữ chân:** dùng "gia hạn thành công" (theo tiền) như đề xuất, hay "còn đăng nhập/hoạt động sau 30 ngày" (theo sử dụng)?
