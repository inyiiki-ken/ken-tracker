# God Mode / Multi-Tenant Setup

The app runs in **single-tenant** mode by default (one sheet for everyone, via
`GOOGLE_SHEET_ID`) — nothing changes until you turn on multi-tenant below.

## 1. Create your Control sheet (the customer registry)

Make a new Google Sheet you own. Add a tab named exactly **`Tenants`** with this
header row (row 1, exact spelling):

```
tenantId | displayName | allowedEmails | emailDomain | sheetId | active | plan | notes
```

One row per customer. Example:

| tenantId | displayName | allowedEmails | emailDomain | sheetId | active | plan | notes |
|----------|-------------|---------------|-------------|---------|--------|------|-------|
| mykabayan-a1b2 | MYKabayan | owner@myk.com, staff@myk.com | | 1NtI_Qush2r9…FJRE | true | Pro | |
| glamco-9x8y | Glam Cosmetics | ana@glam.com | glam.com | 1AbC…Xyz | true | Trial | |

Notes:
- `sheetId` can be the full link (`https://docs.google.com/…/d/<ID>/edit…`) or
  just the ID — the app extracts it.
- `allowedEmails` is comma/space separated. `emailDomain` optionally lets anyone
  at that domain in. Either is enough.
- `active` = `false`/`no`/`0` disables a customer; blank or `true` = active.
- `tenantId` can be anything unique; God Mode generates one if you leave it blank
  when adding via the UI.

## 2. Share every sheet with the service account

Each customer sheet **and** the Control sheet must be shared as **Editor** with
your service-account email (`GOOGLE_SERVICE_ACCOUNT_EMAIL` from `.env.local`).
Without this the app can't read/write them.

## 3. Set environment variables (`.env.local`)

```
CONTROL_SHEET_ID=<your control sheet id>
DEVELOPER_EMAILS=you@gmail.com|partner@gmail.com
```

`DEVELOPER_EMAILS` are the God Mode accounts (you). They can manage all
customers and switch between workspaces regardless of any customer's Roles sheet.

## 4. Use it

Sign in with a developer email → a **God Mode** tab appears. There you can:
- See every customer and which workspace is active.
- **Add customer**: name, allowed emails (or domain), paste their sheet link —
  it's validated (connection + headers) before saving to the Control sheet.
- **Switch**: become any customer's workspace; every tab then shows their data.
  The active customer's name shows in the header.

Regular customers signing in only ever see their own workspace, resolved from
their email — they never see God Mode or anyone else's data.

## How isolation is enforced

The active sheet is derived **server-side** from the signed-in email (never from
anything the browser sends). A customer can't point the app at another customer's
sheet. Only developer emails can switch workspaces, and that switch is re-checked
on the server on every request.
