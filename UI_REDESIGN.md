# UI Redesign — Breeder Workspace
Đích: theo mockup iDogs-Breeder-workspace-small.png (đặt file này vào docs/mockups/)
Nguyên tắc: reskin pages hiện có TRƯỚC, modules mới SAU. Data model không đổi.

## Design directions (từ mockup)
- Sidebar trái nền trắng, icon + label, nhóm: Dashboard/My Dogs/Litters/Puppies/Buyers/Reminders/Documents/Activity/Reports/Settings
- Topbar: greeting + date, notification bell, user menu (avatar, tên, role)
- Cards trắng bo góc, shadow nhẹ, stat cards hàng ngang trên cùng có "View all →"
- Plan usage widget cuối sidebar (plan name, dogs x/50, storage, Upgrade button)
- Status badges: Active (xanh), Closed (xám)

## Milestones
- [ ] M1 — Design tokens: palette/typography/spacing/button/card/badge components dùng chung
- [ ] M2 — Layout shell: sidebar mới + topbar + plan widget (nav items Puppies/Buyers/Reports trỏ placeholder "Coming soon")
- [ ] M3 — Dashboard: 6 stat cards + panels Recent Dogs / Upcoming Reminders / Litters Overview / Documents / Recent Activity + NSW compliance banner
- [ ] M4 — My Dogs + Dog Detail reskin (GIỮ NGUYÊN logic compliance tab, chỉ đổi vỏ)
- [ ] M5 — Litters + Reminders + Documents pages reskin
- [ ] M6 — QA: empty states, loading states, responsive tablet, dark-data edge cases
- [ ] M7 (sau cùng, tách riêng): modules Buyers/Puppies/Reports thật — cần bàn data model trước, KHÔNG tự làm

## Log
(mỗi session ghi: ngày, milestone, staging URL, notes)
