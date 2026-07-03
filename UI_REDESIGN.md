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
- [ ] M2 — Layout shell: sidebar mới + topbar + plan widget (nav items Puppies/Buyers/Reports trỏ placeholder "Coming soon")
- [ ] M3 — Dashboard: 6 stat cards + panels Recent Dogs / Upcoming Reminders / Litters Overview / Documents / Recent Activity + NSW compliance banner
- [ ] M4 — My Dogs + Dog Detail reskin (GIỮ NGUYÊN logic compliance tab, chỉ đổi vỏ)
- [ ] M5 — Litters + Reminders + Documents pages reskin
- [ ] M6 — QA: empty states, loading states, responsive tablet, dark-data edge cases
- [ ] M7 (sau cùng, tách riêng): modules Buyers/Puppies/Reports thật — cần bàn data model trước, KHÔNG tự làm

## Log
(mỗi session ghi: ngày, milestone, staging URL, notes)

| Ngày | Milestone | Staging URL | Notes |
|------|-----------|-------------|-------|
| 2026-07-03 | M1 — Design tokens | https://idogs-i3xfqr2zk-izipawsltd-tonys-projects.vercel.app | Bổ sung tokens (page-bg, sidebar-bg, spacing scale, shadow-card, badge-active/closed); tạo Card/Badge/Button/StatCard components |
| 2026-07-03 | M1b — Brand palette | https://idogs-m7pocapkd-izipawsltd-tonys-projects.vercel.app | Chuẩn hoá brand-900/600/300/50, gold-500/50, gray-100, success/warning/danger/info; map btn-primary + badges sang tokens mới; thay hardcoded hex trong 7 files |
