# MYK Tracker → Multi-Tenant Product (Architecture & Plan v2)

Turning the single app into a **product you resell**: many customers, each with
their own Google Sheet, branding, pricing, and sources — and **you (developer)
in "God Mode"** managing all of them from one login. Plus a desktop installer
and future mobile apps.

This document is the plan. Nothing here is built yet except the upgraded
one-click **verify connection & headers** (item 2), which now accepts a pasted
sheet link/ID so you can test a customer's database before onboarding.

---

## The one thing that changes everything: how clients reach the data

Your note said *"no domain needed because it just calls the Google Sheet
directly."* That's the one assumption we have to correct, because it decides the
whole architecture and the security of every customer's data.

To read/write a Google Sheet you need credentials. Today the app uses **one
service-account private key**, kept on the server side (Next.js). The danger:
if that key is embedded inside a desktop `.exe` or a mobile app, anyone can
extract it from the install and read/write **every customer's sheet**. That's a
multi-tenant data breach. So "call the sheet directly from the app" is not safe
once you have paying customers. Here are the three real options:

### Option A — Central backend (recommended)
Deploy this Next.js app **once** (Vercel's free tier gives you a free
`your-app.vercel.app` URL — no paid domain required). It holds the service key
and the tenant registry. Customers use a thin desktop/mobile app that points at
that URL. You get true God Mode in one place; mobile is trivial (same backend).
- ✅ Secure (key never leaves your server), scalable, central management, easy mobile.
- ⚠️ Needs the app hosted at a URL (free), and internet to use (fine — Sheets needs internet anyway).

### Option B — Fully local, per-customer key
Each customer's install bundles **their own** service-account key + their sheet
ID. A leaked key only exposes that customer's own sheet.
- ✅ No hosting, fits "desktop .exe, no domain."
- ⚠️ You must create a Google Cloud service account per customer; God Mode can't
  manage them centrally (you'd push config to each PC); mobile is insecure/hard.

### Option C — Google sign-in only (no service key anywhere)
Each user signs in with **their own Google account**; the app reads/writes the
sheet **as them** (their Google permission). You share each customer's sheet
with their account. Tenant registry lives in a master sheet you own.
- ✅ No embedded secrets, works desktop + mobile, audit trail = real person.
- ⚠️ Every user needs a Google account and must grant access once; slightly more
  login friction; still benefits from a tiny hosted piece for God Mode.

**My recommendation: Option A now** (central backend on a free Vercel URL),
optionally layering Google sign-in (C) later for per-user identity. It's the
only one that gives you real God-Mode central management *and* an easy path to
mobile, and it keeps every customer's data safe. The desktop `.exe` then becomes
a tiny window that loads your hosted app — no terminal, nothing scary.

---

## Multi-tenant model

**Tenant registry** (list of customers). One row per customer:
`tenantId · displayName · allowedEmails or emailDomain · sheetId · active · plan · notes`.
Stored in a **master "Control" Google Sheet that you own** (simple, you can edit
it by hand too) — or a small database if we outgrow it.

**Per-tenant config** (branding, pricing, sources, modules). Stored in **each
customer's own sheet** using the existing marker-row pattern already in the app
(`__BRAND_SETTINGS__`, `__RATES_CONFIG__`, logos, etc.). This means: switch into
a tenant → edit → it writes to their sheet → their users see it. Extra page
logos and brand assets fit here too (new marker rows).

**Login → tenant resolution.** On sign-in, map the user's email/domain →
tenantId → load that tenant's `sheetId` + config → they only ever see their own
account's data. Wrong/unknown email → access denied (already have that screen).

**God Mode (you).** A developer-only console:
- Tenant switcher: pick any customer and see/act as their account.
- Add a new customer (name, allowed emails, paste their sheet link — we validate
  it with the verify check that's already built).
- Edit any tenant's branding, logos, fonts, colors, extra pages.
- Edit any tenant's pricing/config (below).
- Enable/disable modules (tabs) per tenant.
- Activate/deactivate or change plan.

---

## Configurable pricing engine (no more hardcoded numbers)

Today these are hardcoded in `lib/calculations.ts` / `lib/ratesStore.ts`:
`USD_TO_AED = 3.67`, gold making-charge tiers (`16 / 21 / 25`), per-pc supplier
`115` (and `230` for B1T1), silver sell/cost defaults, PHP conversion, historical
PHP-rate table. We move all of these into a **per-tenant Pricing Config** you edit
in God Mode (stored in the tenant's sheet):

- Currency conversions (USD↔AED, PHP rate, add any currency).
- Gold: making-charge tiers, supplier/gold-rate basis.
- Silver: sell/cost, branded sell/cost.
- Per-piece / screw-type prices, B1T1 multiplier.
- Default statuses, remittance options.

`calculations.ts` reads from this config instead of constants. When a customer
asks for a change, you edit their profile — no code, no messaging me.

**Note:** rates currently live in each browser's `localStorage`, so a customer's
5 PCs can disagree. We move rates fully into the tenant sheet config so every PC
and the mobile app stay in sync.

---

## "All-in-one" tracker: industry templates

Jewellery is weight-based (grams × rate + making charge). A shirt or cosmetics
seller is **unit-price** (price per item, qty × price). To serve both, add a
per-tenant **Industry Template**:

- **Jewellery (weight-based):** grams, gold/silver rate, making charge, T.O.G.
- **Retail (unit-price):** qty × unit price, variants (size/color), no grams.
- **Custom:** pick which fields/labels show.

The template drives which columns appear, what the masterlist expects, and which
pricing rules run. Your `DATA'S` sheet already makes categories/sources/currencies
editable per customer — templates extend that idea to the *pricing math* and
*field labels*, so the same app fits jewellery, apparel, or cosmetics.

**Masterlist suggestion:** keep the current format (metadata rows + data from
row 6 + `DATA'S` dropdowns), but (1) already fixed multi-sheet import, (2) add a
downloadable per-industry template file, (3) add an import **preview** (show
parsed rows + which sheets/pages before writing), (4) validate against the
tenant's `DATA'S` options and flag unknown categories/sources.

---

## Desktop app (installer, no visible terminal)

- **If Option A:** wrap the hosted app in a small **Electron** shell — a single
  window that loads your URL. `electron-builder` produces a normal Windows
  installer (NSIS): double-click → installs → desktop + Start-menu icon → opens
  as a plain app window. No CMD, no terminal. (~5 MB of our code; Electron
  runtime bundled.) macOS `.dmg` from the same setup if needed.
- **If Option B/local:** Electron bundles the whole Next.js server and runs it
  hidden in the background; same clean window. Bigger installer, more moving parts.

Either way the customer sees an app icon, not a console. `run-app.bat` /
`stop-app.bat` get removed.

## Mobile app (Android + iOS)

Wrap the same web UI with **Capacitor** (or build native later). With Option A
it just points at your backend — one codebase, both stores. You're right that no
*separate* backend rewrite is needed; but it should talk to the hosted app, not
embed the Google key. Publishing needs Apple ($99/yr) and Google ($25 once)
developer accounts.

---

## What to ADD (checklist)

1. Central backend deploy (free Vercel URL) — *if Option A*.
2. Tenant registry (master Control sheet) + loader.
3. Login → tenant resolution; strict per-tenant data isolation.
4. God-Mode console: tenant switcher, add/edit customer, validate sheet (built).
5. Per-tenant branding incl. extra-page logos & brand assets.
6. Per-tenant configurable pricing engine (replace all hardcoded numbers).
7. Move rates from localStorage → tenant sheet config (multi-PC sync).
8. Industry templates (jewellery / retail / custom) + adaptive fields.
9. Masterlist: import preview + validation + downloadable templates.
10. Desktop installer (Electron) — no terminal.
11. Mobile wrapper (Capacitor) — later phase.
12. Per-tenant module toggles (show/hide tabs).

## What to REMOVE / retire

- `run-app.bat`, `stop-app.bat` → replaced by the installer.
- Hardcoded `config/brand.ts` values → per-tenant (keep file as fallback only).
- Hardcoded pricing in `calculations.ts` + historical PHP table → tenant config.
- Committed secrets (done) — keep out of any client bundle.
- Legacy Apps Script `processUpload` (app does this now). **Decision needed** on
  the AirLink delivery-status webhook (`doPost`) — the one piece still only in
  the script: port it into the app, or keep the script.
- localStorage-only rates → tenant config.

---

## Suggested build order

1. **Foundation:** tenant registry + login→tenant resolution + dynamic sheetId
   (data layer already refactored to accept a sheetId). *(biggest unlock)*
2. **God-Mode console:** add/switch/edit customers; validate sheets (built).
3. **Configurable pricing + per-tenant branding/logos** (retire hardcoding).
4. **Industry templates** + masterlist preview/validation.
5. **Desktop installer** (Electron, no terminal).
6. **Mobile** wrapper.

Each phase ends with a typecheck/build gate, same as before.

---

## v3 additions (requested)

### Per-tenant tab control (white-label navigation)
God Mode gains full control over each customer's tabs, stored as a per-tenant
config in their sheet (Uploads marker row `__TAB_CONFIG__`):
- **Visibility:** choose which tabs a customer sees (e.g. MYKabayan gets Admin +
  Invoicing only; another gets everything).
- **Rename:** relabel any tab per customer (e.g. "Bossing" → "Rexie/Analyn",
  "Liver" → "Sellers"). The internal key stays the same; only the label changes.
- **Order & icon** (optional): reorder tabs, pick an icon.
- Enforced the same secure way as data isolation — config is loaded for the
  active tenant only.

### "Full per-element editing" — realistic scope
True drag-anything page-building is a product in itself and not worth building
from scratch. Instead we deliver **practical white-label customization** that
covers ~95% of what you'll actually want, all editable by you in God Mode per
customer:
- Tab visibility, names, order, icons (above).
- Brand identity: company name, logos (header + invoice + **extra page logos**),
  colors, fonts, taglines, location.
- Editable label/terminology overrides (e.g. "Miner Name" → "Client", "Grams" →
  "Qty") so the vocabulary fits each industry.
- Editable option lists (categories, sources, currencies, statuses) via DATA'S.
- Editable pricing/number config (making charge, costs, conversion rates).
- Per-tenant module/field toggles (show/hide columns and sections).

If you later want literal per-pixel editing, that's a much bigger, separate
phase — flagged, not promised.

### Tab-by-tab UI fixes / rebuilds (developer judgment)
Review and improve each dashboard for clarity, consistency, and usefulness:
- **Admin pipeline** — tighten the pipeline stages/readability.
- **Dispatch** — clean up the board and pullout flow.
- **Accounts** — clearer financials entry/tracking.
- **Liver** — streamline the seller view.
- **Bossing** — analytics polish (already has CSV export + print).
- **Purchasing** — currently a rewards/inventory tab few use; **rebuild as a
  literal Purchasing tab** (supplier purchase orders / cost tracking) — or fold
  into a template-driven module.
- **Invoicing** — verify invoice generation across industries.

### Updated build order (v3)
1. **Configurable pricing** (per-tenant, off localStorage). *(next)*
2. **Per-tenant tab control** (visibility + rename + labels).
3. **Tab-by-tab UI fixes / Purchasing rebuild.**
4. **Industry templates** + masterlist preview/validation.
5. **Deploy (Vercel) → Desktop installer → Mobile.**

