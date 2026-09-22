# Ken Tracker — App Audit Prompt

Paste everything below the line into a fresh session when you want a full review pass.

---

Take a careful look at the current state of this app and improve anything that's obviously off.

Read the code with `Read`, `Grep` and `Glob` before changing anything, and verify each concern in the code rather than guessing. This is a **Next.js 14 App Router** app (TypeScript, Tailwind, shadcn/ui) with a **Google Sheets** backend, **NextAuth** Google sign-in, multi-tenant workspaces, and an **Electron** desktop build. There is no external SDK to consult — the data layer is `lib/google-sheets/` and `lib/zoho/`. Read those directly.

This app is **live with paying customers** (MYKabayan Jewellery, AR Universal). Their real order data and real accounting sit behind it. Prefer a small, verified fix over a confident rewrite.

Go category by category.

<broken_behavior>
  - Buttons wired to nothing.
  - Tabs, nav items, or card actions whose `onClick` goes nowhere.
  - Filters that don't filter, or that filter only the visible page instead of the whole dataset.
  - Forms that don't validate the fields they visibly should — especially anything that writes to the sheet.
  - Server actions in `lib/google-sheets/actions.ts` or `lib/zoho/actions.ts` called with the wrong shape, missing required inputs, or returning data the component never reads.
  - Tables and lists with no empty state, so users see a void when there's nothing to show.
  - Components that fetch but render nothing while loading — no skeleton, no spinner, no "Loading…". `components/ui/motion.tsx` has `Skeleton` and `SkeletonRows`; use them rather than inventing new ones.
  - Destructive or irreversible actions (delete, merge clients, import masterlist, send to Zoho) with no confirmation step.
  - Errors swallowed by an empty `.catch(() => {})` where the user is left thinking the action succeeded.
</broken_behavior>

<auth_and_tenancy>
  Auth here is **real and working** — NextAuth with Google OAuth, configured in `lib/authOptions.ts`, with roles resolved from the **Roles tab in the customer's Google Sheet** and enforced by `lib/google-sheets/authz.ts`. Tenancy is resolved from the signed-in email via `lib/tenancy.ts` and `lib/google-sheets/tenant-context.ts`.

  **Do not replace, refactor, or "modernize" any of this.** The role-from-sheet design is deliberate: it lets each customer manage their own staff without a developer. Treat it as a fixed constraint.

  What to actually verify:
  - Every server action that reads or writes customer data calls the appropriate `requireSession` / `requireRole` guard. A **missing** guard is a real finding; an existing guard is not a bug.
  - No component reads `session.user.*` before confirming the session exists — particularly anything that can render on the sign-in screen.
  - God Mode / super-admin-only actions (tenant switching, backfill, masterlist setup) are gated server-side, not just hidden in the UI. Hidden-but-callable is a real finding.
  - Role checks happen on the **server**, not only in the component. A client-side-only check is a real finding.
  - Nothing logs or returns a secret to the browser — service-account keys, Zoho client secret, or refresh token. The redacted `••••••••` pattern in `lib/zoho/` is intentional; keep it.
</auth_and_tenancy>

<data_layer>
  All customer data lives in Google Sheets via `google-spreadsheet` v4. The rules that matter, learned the hard way:

  - **Row identity is the Row Key, not the row position.** Writes must go through `writeRowsByCells` in `lib/google-sheets/actions.ts`, which resolves rows by key. Anything resolving a row by index is a real bug — a concurrent edit shifts positions and the write lands on the wrong customer's order.
  - **`lib/google-sheets/row-mapper.ts` must map every field in `DATABASE_HEADERS`.** A field present in the schema but missing from the mapper reads back as empty and silently disables whatever depends on it. This has already caused one near-miss with the duplicate-invoice guard. Check the mapper against the header list field by field and report any gaps.
  - **Writes must be batched.** Per-row `getRows()` + `save()` in a loop means one network round-trip per row; bulk status updates become unusable. Flag any loop that saves row-by-row.
  - **The worksheet object is a shared module-level singleton.** Concurrent writes must go through `withSheetWriteLock`. An unlocked write path is a real bug.
  - **Audit trail is capped** at `AUDIT_MAX_ENTRIES` by `appendAudit`. Don't remove the cap — uncapped audit strings overflow the cell limit.
  - **Zoho is guarded by an `enabled` master switch that defaults to false**, plus `findInvoiceByReference()` for idempotency. Both exist to stop the app double-invoicing a real customer's accounts. Do not remove or bypass either. If you find a Zoho write path that skips the idempotency check, that *is* a finding.
  - Don't render a raw internal ID to the user (Row Key, Zoho contact ID, customer ID) where a name or invoice number is what they need to see.
</data_layer>

<tenant_config>
  Almost everything is customer-configurable at runtime, stored as marker rows in each customer's `Ken_Config` tab: `lib/appConfig.ts`, `optionsConfig.ts`, `pricingConfig.ts`, `customToggles.ts`, `brandSettings.ts`, `labelConfig.ts`, `tabConfig.ts`, `businessConfig.ts`, `masterlistMapping.ts`, and Zoho settings.

  - **Never rename a config marker** (`__APP_CONFIG__`, `__BRAND_SETTINGS__`, `__PRICING_CONFIG__`, `__OPTIONS_CONFIG__`, `__CUSTOM_TOGGLES__`, `__ZOHO_SETTINGS__`, and the rest). Renaming one silently orphans every saved setting for every live customer.
  - **Never hardcode a value that already has a setting.** Statuses come from `lib/statusRegistry.ts`, dropdown options from `optionsConfig`, shipping fees from `pricingConfig`, labels from `labelConfig`. A literal status string or a hardcoded fee in a component is a real finding.
  - Config must not leak between tenants. `lib/tenantStorage.ts` wipes customer-scoped local storage on workspace switch. Per-device preferences (`motion_pref`) are deliberately excluded — leave that as is.
  - Adding a new configurable value is fine; changing an existing one's shape or default is not, without saying so explicitly.
</tenant_config>

<design_system>
  Shared components live in `@/components/ui` (Button, Input, Select, Card, Badge, Dialog, Table, and `motion.tsx`). Those are the ones to use — not raw `<button>` / `<input>` / `<select>`, not bespoke Tailwind re-implementations. Red flags:

  - `<button className="...">` where the shared `<Button>` would do.
  - **Hardcoded colours** — `text-emerald-600`, `text-orange-500`, `bg-[#1a1a1a]`, raw hex in `className` or inline `style` — where a theme token exists: `text-primary`, `bg-card`, `text-muted-foreground`, `border-border`, `destructive`. This is the highest-value category in this app: every customer sets their own brand colour and light/dark mode, so a hardcoded colour is a bug that only shows up on someone else's screen. There are roughly 90 of these; fix them, and report the count before and after.
  - Inline `style={{ ... }}` where a Tailwind class and token would do. Exception: genuinely dynamic values (a computed bar width, a customer's brand hex read from config) legitimately need inline style — leave those.
  - A status or enum field rendered as a plain `<Input>` instead of a `<Select>` wired to the values from `statusRegistry` / `optionsConfig`.
  - Status or category shown as plain text or a `<Button>` where a `<Badge>` is correct.
  - Invented radii or shadows (`rounded-[13px]`, arbitrary `shadow-[...]`) instead of theme values. The theme radius is `0.6rem`.
  - The same pattern done three different ways across tabs — pick one and align.
</design_system>

<visual_polish>
  Things that make the app feel half-built: leftover placeholder text ("TODO", "Lorem ipsum", "Foo"), button labels that don't match what the action does, a primary action that doesn't visibly dominate, dead placeholder pages, obviously accidental padding, text that overflows or truncates badly at the phone widths the PWA is used at.
</visual_polish>

<what_to_skip>
  - Defensive null checks on values `row-mapper.ts` already guarantees are strings.
  - Speculative "what if X differs from Y" bugs not evidenced in the code.
  - Code style, naming, file organization, test coverage, TS strictness.
  - Shotgun rewrites of code that already works — scope changes to what's actually broken.
  - The service-account key bundled in the `.exe`. Known, deliberately deferred, being handled separately.
  - Full-table loads / the ignored `tailOnly` flag. Known and deferred.
  - The `.env` resolution order in `electron/` — bundled config must win over the user's app-data copy. That ordering is a fix, not a bug.
</what_to_skip>

Before you finish: run `npm run typecheck` and confirm zero errors. Then tell me, in plain terms, what you changed and what I should click to confirm it still works. Group findings by whether they affect **live customer data**, **what the customer sees**, or **neither**.

If the app is already in good shape, say so instead of manufacturing issues. A zero-finding pass is a valid result.
