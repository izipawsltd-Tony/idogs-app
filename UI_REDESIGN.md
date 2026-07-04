# UI Redesign — Breeder Workspace
Đích: theo mockup iDogs-Breeder-workspace-small.png (đặt file này vào docs/mockups/)
Nguyên tắc: reskin pages hiện có TRƯỚC, modules mới SAU. Data model không đổi.

## Design directions (từ mockup)
- Sidebar trái nền trắng, icon + label, nhóm: Dashboard/My Dogs/Litters/Puppies/Buyers/Reminders/Documents/Activity/Reports/Settings
- Topbar: greeting + date, notification bell, user menu (avatar, tên, role)
- Cards trắng bo góc, shadow nhẹ, stat cards hàng ngang trên cùng có "View all →"
- Plan usage widget cuối sidebar (plan name, dogs x/50, storage, Upgrade button)
- Status badges: Active (xanh), Closed (xám)
- **Tagline iDogs: "Every dog's story, forever."** — mockup ghi "One dog. One identity." là SAI, bỏ qua. Hiển thị tagline đúng dưới logo sidebar (nếu vừa chiều ngang) và giữ nguyên vị trí hiện có trên hero landing page. KHÔNG dùng tagline này cho iziPaws.

### Brand palette — vai trò màu

| Token | Hex | Dùng cho | KHÔNG dùng cho |
|-------|-----|----------|----------------|
| `--brand-900` | #1A3A2A | Sidebar text, headings, QR dark pixels | Nền rộng |
| `--brand-600` | #2E7D4E | **Action duy nhất**: buttons, links, active nav, focus ring | Text phụ, decoration |
| `--brand-300` | #6BAE7B | Decorative dot, divider accent | Text trên nền trắng (contrast thấp) |
| `--brand-50` | #F3F8F4 | Hover/selected bg, badge tint | Không |
| `--gold-500` | #D4AF37 | **Premium chỉ**: Kennel plan badge, Upgrade CTA, crown icon | Action thường |
| `--gold-50` | #FAF7EB | Badge bg premium | Không |
| `--success` | #2E7D4E | Status "Active", confirm toast | Không dùng thay brand-600 |
| `--warning` | #B45309 | Vaccine uncertain, compliance amber | Không |
| `--danger` | #B91C1C | Xóa, overdue, error state | Không |
| `--info` | #1D4ED8 | Info toast, help link | Không |
| `--gray-100` | #F2F4F7 | Page background | Card bg (dùng white) |

## Milestones
- [x] M1 — Design tokens: palette/typography/spacing/button/card/badge components dùng chung
- [x] M2 — Layout shell: sidebar mới + topbar + plan widget (nav items Puppies/Buyers/Reports trỏ placeholder "Coming soon")
- [x] M3 — Dashboard: 6 stat cards + panels Recent Dogs / Upcoming Reminders / Litters Overview / Documents / Recent Activity + NSW compliance banner
- [ ] M4 — My Dogs + Dog Detail reskin (GIỮ NGUYÊN logic compliance tab, chỉ đổi vỏ)
- [ ] M5 — Litters + Reminders + Documents pages reskin
- [ ] M6 — QA: empty states, loading states, responsive tablet, dark-data edge cases
- [x] M7 (sau cùng, tách riêng): modules Buyers/Puppies/Reports thật — COMPLETE (#1–#5 done, staging verified)
  - [x] M7 #1 — Insights (Reports V1): Breeding Overview (reuse breedingCompliance.checkDamCompliance) + Litter Production + Health Test Coverage + Sales & Transfers. Route /app/reports, label hiển thị "Insights". Sales funnel chờ M7 #2.
  - [x] M7 #2 — Puppy lifecycle fields (availabilityStatus/reservedFor*/deposit*/buyer*/status → promote lên Dog type §7a). Tham chiếu M7_DATA_MODEL.md
  - [x] M7 #3 — Reservation UI (gộp chung vào Sale & availability panel, #2b). Tham chiếu M7_DATA_MODEL.md
  - [x] M7 #4 — Deposit UI (gộp chung vào Sale & availability panel, #2b). Tham chiếu M7_DATA_MODEL.md
  - [x] M7 #5 — Buyers derived view (BuyersPage.tsx, grouped client-side từ getDogs(), không collection riêng). Tham chiếu M7_DATA_MODEL.md
  - [x] M7 #6 (ngoài kế hoạch gốc) — My Dogs "Transferred" đổi từ toggle ẩn/hiện sang FILTER riêng (chỉ hiện dog transferred, không dim) — confirmed landed commit 2fe8bbd4, staging verified

## Backlog (low-priority, chưa bắt đầu)
- Transfer modal đang trùng lặp code ở 3 nơi: `LittersPage.tsx`, `DogDetailPage.tsx` (TransferModal nội bộ), và `src/components/ui/TransferOwnershipModal.tsx` (shared component nhưng KHÔNG được 2 trang kia dùng — orphan). Cần gộp lại 1 component dùng chung.
- Compliance rules bị lặp: logic inline trong `DogDetailPage.tsx` (BreedingTab) vs `src/lib/breedingCompliance.ts`. Cần rà soát và hợp nhất về 1 nguồn.
- Optional: verify lại logic group buyer trong `BuyersPage.tsx` (`resolveIdentity()` — thứ tự ưu tiên email/phone) so với `M7_DATA_MODEL.md` §5, đây là điểm thay đổi duy nhất nếu cần chỉnh semantics.

## Log
(mỗi session ghi: ngày, milestone, staging URL, notes)

| Ngày | Milestone | Staging URL | Notes |
|------|-----------|-------------|-------|
| 2026-07-03 | M1 — Design tokens | https://idogs-i3xfqr2zk-izipawsltd-tonys-projects.vercel.app | Bổ sung tokens (page-bg, sidebar-bg, spacing scale, shadow-card, badge-active/closed); tạo Card/Badge/Button/StatCard components |
| 2026-07-03 | M1b — Brand palette | https://idogs-m7pocapkd-izipawsltd-tonys-projects.vercel.app | Chuẩn hoá brand-900/600/300/50, gold-500/50, gray-100, success/warning/danger/info; map btn-primary + badges sang tokens mới; thay hardcoded hex trong 7 files |
| 2026-07-03 | M2 — Layout shell | https://idogs-p5qbug410-izipawsltd-tonys-projects.vercel.app | Sidebar 240px trắng + logo + tagline "Every dog's story, forever." + nav groups (MAIN/BREEDING/MANAGE/ACCOUNT) + brand-600 active state; Topbar 60px greeting+date+bell+user menu dropdown; Plan widget (dogCount/limit, progress bar, Upgrade CTA); ComingSoonPage cho Puppies/Buyers/Reports; page-bg var(--gray-100); responsive mobile giữ nguyên |
| 2026-07-03 | M3 — Dashboard | https://idogs-brrm0m11e-izipawsltd-tonys-projects.vercel.app | 6 stat cards clickable (Dogs/Active/Overdue/Puppies/Litters/Documents) + PanelCard component; panels: Recent Dogs (top 5 + badge-active/closed) / Litters Overview (status badge + puppy count) / Upcoming Reminders / Documents summary / Recent Activity (audit log, timeAgo) / NSW compliance banner reskin sang brand tokens; fetch getAllDocumentsForUser + getLitters + getAuditLogs trên dashboard |
| 2026-07-04 | M7 #1 Insights | https://idogs-d6l74jr7h-izipawsltd-tonys-projects.vercel.app | ReportsPage.tsx + lib/reports.ts; nav "Reports"→"Insights"; commit 516d6bd1 on feature/ui-redesign; NOT on prod (UI Redesign freeze) |
| 2026-07-04 | M7 #2b Sale & availability | https://idogs-7js2erot1-izipawsltd-tonys-projects.vercel.app | Panel trong Dog Detail Overview (availabilityStatus/reservedFor*/deposit*); commit 189265a4 |
| 2026-07-04 | M7 #2c Transfer prefill + buyerPhone | https://idogs-cxc87pb4u-izipawsltd-tonys-projects.vercel.app | Transfer modal (Litters + Dog Detail) prefill từ reservedFor*, thêm buyerPhone; commit 398de8de |
| 2026-07-05 | My Dogs Transferred → filter | https://idogs-qfjjh0yef-izipawsltd-tonys-projects.vercel.app | Đổi từ toggle ẩn/hiện sang filter riêng (không dim); commit 2fe8bbd4 |
| 2026-07-05 | M7 #5 Buyers | https://idogs-38efg4u2g-izipawsltd-tonys-projects.vercel.app | BuyersPage.tsx (derived view, grouped client-side); wired route+nav; commit 8dcd8c2e — M7 COMPLETE |
