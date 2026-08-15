# Super SaaS Admin — QA Checklist

Internal, non-sensitive checklist for manually verifying the Super Admin
console before any push/deploy. Contains no credentials, secrets, env
values, or private data — only routes, expected behaviors, and the two
already-public allowlisted admin emails.

## 1. Routes to test (logged in as an allowlisted Super Admin)

- `/app/super-admin/dashboard`
- `/app/super-admin/organisations`
- `/app/super-admin/organisations/:id` (open one from the list)
- `/app/super-admin/users`
- `/app/super-admin/users/:uid` (open one from the list)
- `/app/super-admin/subscriptions`
- `/app/super-admin/plans-pricing`
- `/app/super-admin/audit-logs`
- `/app/super-admin/audit-logs/:id` (open one from the list)
- `/app/super-admin/support-inbox`
- `/app/super-admin/support-faqs`
- `/app/super-admin/settings`

For each route, confirm:
- [ ] Page loads without a blank screen or console crash
- [ ] Loading state appears briefly, then resolves
- [ ] Data populates (or a clear empty state shows if there's nothing to display)
- [ ] Sidebar highlights the correct nav item as active
- [ ] No disabled button is clickable or triggers a network request
- [ ] Read-only notice is visible where expected (Subscriptions, Plans & Pricing, Audit Logs, Settings)
- [ ] V1 data-model limitation notice is visible where expected (Subscriptions, Plans & Pricing, Audit Logs)
- [ ] No Stripe/payment live action is reachable anywhere (Plans & Pricing, Settings integration buttons all disabled)
- [ ] Support Inbox reply/assign/status actions work and remain Super Admin protected
- [ ] FAQ search, status filter, save draft, publish and unpublish work

## 2. Detail-page specific checks

- [ ] Organisation detail: open a non-existent `:id` → shows "Organisation Not Found", not a generic error
- [ ] User detail: open a non-existent `:uid` → shows "User Not Found", not a generic error
- [ ] Audit log detail: open a non-existent `:id` → shows "Event Not Found"
- [ ] Cross-links resolve correctly:
  - Users list → User detail
  - Organisations list → Organisation detail
  - Subscriptions → View User / View Org (Org link only for breeder-role rows)
  - Audit Logs → View / View User / View Org
  - Support Inbox → View User / View Organisation

## 3. Access control checks

- [ ] Sign in with a non-admin (non-allowlisted) account → every `/app/super-admin/*` route shows "Access Denied", not data
- [ ] Sign in with an allowlisted admin whose email is **not verified** → redirected to `/verify-email`, never reaches the console
- [ ] Confirm the two allowlisted Super Admin emails match in both places:
  - `api/super-admin/_auth.js` → `ALLOWED_ADMINS`
  - `src/super-admin/superAdminConfig.ts` → `SUPER_ADMIN_EMAILS`
  - (currently: `trunghieungo@gmail.com`, `theresanguyenngo@gmail.com`)

## 4. API guard checks (no Authorization header → expect 401 JSON)

```
GET /api/super-admin/dashboard
GET /api/super-admin/organisations
GET /api/super-admin/organisations/<id>
GET /api/super-admin/users
GET /api/super-admin/users/<uid>
GET /api/super-admin/subscriptions
GET /api/super-admin/plans-pricing
GET /api/super-admin/audit-logs
GET /api/super-admin/audit-logs/<id>
GET /api/super-admin/support-inbox
GET /api/super-admin/support-faqs
GET /api/super-admin/settings
```

Each should return `401 {"error":"Unauthorized: Missing Authorization header"}`.

## 5. Controlled-write safety checks

- [ ] All write actions require the verified Super Admin API guard
- [ ] Sensitive actions retain confirmation/reason requirements where applicable
- [ ] No page or API response contains a private key, service account email, Stripe secret/price ID, or other credential
- [ ] FAQ and Support writes create audit records and expose no credentials

## 6. Pre-push / pre-preview-deploy checks

- [ ] `npm run build` passes with no errors
- [ ] All API guard checks in section 4 pass (401 JSON, no Authorization header)
- [ ] `git status -u` reviewed — no `.env.local`, no service account JSON, nothing outside the intended diff staged
- [ ] No production env, Firebase/Vercel cloud config, or Firestore rules/data touched
- [ ] Tony has explicitly approved pushing this branch to the remote
- [ ] Tony has explicitly approved a `vercel deploy` (Preview) run
- [ ] `vercel deploy --prod` is NOT run under any circumstance without a separate, explicit Tony go-ahead
