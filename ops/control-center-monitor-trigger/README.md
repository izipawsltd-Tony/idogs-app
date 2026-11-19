# Đồng hồ ngoài cho giám sát Control Center

GitHub chạy lịch `schedule` của repo này trễ nhiều giờ (15–19/11/2026: cách nhau 6–9 giờ). Worker Cloudflare này là đồng hồ ngoài: cứ 10 phút nó yêu cầu GitHub chạy workflow `control-center-monitor.yml` trên `master` qua `workflow_dispatch` (input `trigger=external-cron`). Việc kiểm tra website, trạng thái giữa các lượt (Actions cache) và log từng lượt vẫn nằm ở GitHub Actions.

Worker không gọi idogs.com.au, không đọc mã nguồn, không gửi email và không có địa chỉ web công khai (mọi request trả 404).

## Cần Owner duyệt trước khi bật
1. Hạ tầng mới: một Worker trên tài khoản Cloudflare đang quản lý DNS idogs.com.au (gói miễn phí đủ dùng: 144 lượt/ngày).
2. Secret mới: Owner tự tạo fine-grained token GitHub, **chỉ repo `izipawsltd-Tony/idogs-app`**, quyền **Actions: Read and write**, không quyền nào khác, hạn 90 ngày. Owner tự dán vào Cloudflare làm secret `GITHUB_DISPATCH_TOKEN`. Claude không nhập token.
3. Merge thay đổi workflow vào `master` (cần đối chiếu cấu hình Vercel và deployment ID/SHA của idogs.com.au trước và sau).

## Cách bật (sau khi được duyệt)
```
cd ops/control-center-monitor-trigger
npx wrangler deploy
npx wrangler secret put GITHUB_DISPATCH_TOKEN   # Owner tự dán token
```
Hoặc trên dashboard Cloudflare: Workers & Pages → Create → dán `worker.mjs`, thêm Cron Trigger `*/10 * * * *`, thêm secret `GITHUB_DISPATCH_TOKEN`.

## Cách dừng
- Tạm dừng: Cloudflare → Worker `idogs-control-center-monitor-trigger` → Settings → Triggers → xoá Cron Trigger (hoặc `npx wrangler delete`).
- Dừng toàn bộ giám sát (cả lịch GitHub dự phòng): `gh workflow disable control-center-monitor.yml --repo izipawsltd-Tony/idogs-app`.
- Thu hồi quyền: GitHub → Settings → Developer settings → Fine-grained tokens → Revoke.

## Nghiệm thu
Sau ít nhất 24 giờ, lấy từ log từng lượt dòng `outcome=... trigger=... counted=...` thành JSON `[{id, trigger, startedAt, outcome, counted}]` rồi chạy:
```
node scripts/control-center-monitor-history.mjs <from-ISO> <to-ISO> < runs.json
```
Quan sát hợp lệ = lượt **tự động** (`schedule` hoặc `external-cron`), **được tính** (không phải lượt trùng) và đã quan sát được website (WEBSITE_OK hoặc WEBSITE_ERROR). Lượt thủ công, lượt push và lượt trùng không bao giờ làm cửa sổ đạt. Đạt khi cửa sổ ≥ 24 giờ và khoảng cách lớn nhất giữa hai quan sát hợp lệ ≤ 30 phút.
