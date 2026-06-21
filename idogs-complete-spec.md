# iDogs — Hoàn thành 3 việc dở dang (theo thứ tự ưu tiên)

> Paste vào Claude Code (`claude --dangerously-skip-permissions`) trong thư mục
> `C:\Users\Tom\Downloads\idogs-app-phase1\`. Làm tuần tự theo 3 phần dưới, **không push production
> ở từng bước riêng lẻ** — gộp tất cả lại, verify hết trên staging rồi mới push 1 lần.

---

## Bước 1 — Deploy + test "Dog Life Story" (code đã xong, chưa test)

Feature đã được code đầy đủ trong session trước:
- `syncLifeStage()` trong `db.ts` — breed-aware life stage calculation
- Timeline hợp nhất theo thời gian trong `DogDetailPage.tsx`
- Activity Note photo upload qua endpoint `api/upload-note-photo.js`
- Milestone detection (birthday/anniversary) + nhánh email trong `send-reminders.js`

**Việc cần làm:**
1. Confirm code trên đúng đang nằm ở local, chưa bị mất sau sự cố nào (check git log/diff)
2. Deploy lên staging: `vercel deploy` (Preview, dùng `idogs-app-staging` Firebase project + `.env.staging`)
3. Test checklist:
   - [ ] Mở 1 dog profile bất kỳ → confirm life stage hiển thị đúng theo breed (vd Puppy/Adult/Senior tính đúng theo giống)
   - [ ] Timeline hiển thị đúng thứ tự thời gian, gộp đủ các loại event (vaccination, note, milestone...)
   - [ ] Thêm 1 Activity Note kèm ảnh → confirm ảnh upload thành công và hiển thị trong timeline
   - [ ] Trigger thử cron `send-reminders.js` (hoặc gọi endpoint thủ công) → confirm email milestone (birthday/anniversary) gửi đúng nội dung, đúng dog

Nếu pass hết → giữ nguyên, KHÔNG push prod vội, chuyển sang Bước 2.

---

## Bước 2 — Fix 2 bug

### Bug 2a: `[object Object]` hiển thị ở hipScore
- Tìm nơi hipScore được render (component hiển thị Health Testing tab — Hip/Elbow)
- Nguyên nhân khả nghi: đang render trực tiếp 1 object thay vì field con của nó (vd `{score, date}` thay vì `score`)
- Fix: trace đúng field cần hiển thị, đảm bảo type-safe (TypeScript interface đúng shape)

### Bug 2b: Hip/Elbow "Date Tested" không áp dụng từ scan
- Khi AI scan giấy tờ Hip/Elbow, field "Date Tested" không được ghi vào dog profile dù scan đã nhận diện được ngày
- Tìm trong `api/scan.js` (hoặc nơi xử lý kết quả scan) — kiểm tra mapping field "Date Tested" có được đưa vào payload ghi Firestore không, hay bị bỏ sót ở bước map AI output → dog profile fields

Sau khi fix cả 2, test lại trên staging:
- [ ] Xem 1 dog profile có hipScore → không còn hiện `[object Object]`
- [ ] Scan thử 1 giấy tờ Hip/Elbow mới → confirm "Date Tested" được điền đúng vào profile

---

## Bước 3 — Hoàn thiện Breeder ID (Feature A) — phần `DogNewPage.tsx`

Phần này đang dở dang, cần xem lại các phần đã code trước đó của Feature A (Breeder ID) ở các file
khác để hiểu logic tổng thể, rồi hoàn thiện nốt phần còn thiếu trong `DogNewPage.tsx` (form tạo dog
mới) — đảm bảo Breeder ID được gán/hiển thị/lưu đúng khi tạo dog mới, nhất quán với phần đã code ở
nơi khác.

Test:
- [ ] Tạo 1 dog mới → confirm Breeder ID xuất hiện đúng, lưu đúng vào Firestore

---

## Bước 4 — Gộp & verify staging, rồi mới push production

Sau khi cả 3 bước trên đều pass trên staging:
1. `npm run build` (bắt buộc trước git, theo convention hiện có)
2. `git pp "fix: hipScore display, hip/elbow date tested, breeder ID DogNewPage + dog life story deploy"` (chạy trong `cmd`, không phải PowerShell)
3. `vercel deploy --prod`
4. Test nhanh lại trên production sau khi deploy (smoke test 4 điểm trên ở bản live)
