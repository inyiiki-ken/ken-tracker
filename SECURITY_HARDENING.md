# Security hardening plan

Honest assessment of the current app and the concrete fixes, mapped to *this*
architecture (Next.js server + Google Sheets via a service-account robot — no
Firebase/Supabase, no public web host in the desktop model).

## Threat model first (this changes what matters)

**Desktop model (what you're shipping now):** the server runs on `127.0.0.1`
inside each install — **not reachable from the internet**. So the classic web
threats (DDoS, anonymous internet access, needing Cloudflare/WAF) **don't apply**.
The realistic attacker is a **staff member on that PC** using browser devtools to
call server actions their role shouldn't allow, or someone who copies the config
off the machine.

**Hosted model (if you ever centralise):** the server becomes internet-facing and
**all** of the below become important, including rate limiting.

## Current posture

| Area | Status | Notes |
|------|--------|-------|
| Login | ✅ OK | NextAuth + Google is a proper auth system (Clerk not needed). |
| Cross-customer isolation | ✅ Good | Active sheet is derived **server-side from the login**, never from client input — one customer can't reach another's data. |
| Secrets | ⚠️ Mitigated | Per-customer robot key = a leaked machine exposes only that customer's own sheet. Rotate the originally-exposed keys (see SECURITY.md). |
| Server-side authorization | ✅ Implemented | Every write action now re-checks the session/role server-side (`lib/google-sheets/authz.ts`). Config saves = super_admin/developer; record & purchasing writes require sign-in / role. Safety valve: `DISABLE_SERVER_AUTHZ=true`. |
| IDOR | ⚠️ Partly | Cross-customer closed (sheet derived from session). Within-customer per-record ownership still optional/pending. |
| Rate limiting | ❌ None | Only relevant if hosted. |
| Row-level security | n/a | Google Sheets has none; everyone in a customer sees that customer's data (by design). |

## Fixes (priority order)

### 1. Server-side session + role enforcement (the important one)
Add a small authz layer used by every **mutating** server action:
- `requireSession()` → resolves the signed-in email server-side (getServerSession); throw if none.
- `getSessionRoles()` → the user's roles from the active tenant's Roles sheet (reusing `config/roles.ts` logic), plus developer→super_admin; cached briefly to avoid extra Sheets calls.
- `requireAnyRole([...])` → throw unless the user has one of the allowed roles.

Apply:
- **Config saves** (branding, pricing, tabs, business type, rates, logos) → `super_admin` / developer only. *Stops a low-privilege staffer changing pricing/branding.*
- **Record writes** (create/update/bulk/split/merge/invoice/import) → must be signed in with any assigned staff role.
- **Purchasing writes** → `purchasing` / `admin` / `super_admin`.
- **Tenant management** (add/switch customer) → developer only *(already enforced)*.

> Sequencing note: implement this **after** login is confirmed working on a real
> install, and test with a non-admin account, so a mis-resolved session can't lock
> anyone out. Checks fail-closed by design.

### 2. IDOR mitigation
With tenant scoping already deriving the sheet from the session, cross-customer
IDOR is closed. Within a customer, add (optional, role-dependent):
- Verify the target row exists in the **active tenant's** sheet before mutating (implicit today, make explicit).
- Optional per-record ownership: e.g., a `liver` may edit only rows whose Liver = them.

### 3. Rate limiting — only if hosted
If/when centralised, add per-session/IP limits on the action endpoints (e.g. a
lightweight token-bucket) to prevent Sheets-API quota exhaustion and abuse. No-op
for the localhost desktop model.

### 4. Hygiene
- Confirm `NEXTAUTH_SECRET` set on every install (login fails without it).
- Keep secrets out of any client bundle (already the case — server-only modules).
- Rotate the originally-exposed keys before real customers (SECURITY.md).

## What we are NOT doing (and why)
- **Cloudflare / firewall:** N/A for a localhost desktop app.
- **Supabase/Firebase RLS:** different stack; not in use.
- **Clerk:** NextAuth already covers auth.
