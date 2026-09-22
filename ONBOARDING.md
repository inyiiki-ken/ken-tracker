# Onboarding a new customer (one-time, ~5–10 min)

Do this once per new customer. The customer never does any of it — they just
install the app and sign in. All of this is free.

Example customer below: **MYKabayan**.

---

## 1. Make their database (Google Sheet)

1. Open your **template** MYK sheet → **File → Make a copy** → name it
   "MYKabayan — Tracker".
2. Confirm it has the tabs the app needs: **Database, Uploads, Roles** (and
   **DATA'S** for dropdowns). The Roles tab is where you list their staff emails
   and roles (admin/dispatch/accounts/liver/etc.).
3. Copy the sheet's **ID** from the URL (the long code between `/d/` and `/edit`).

## 2. Make their robot (service account) — the safe part

1. Google Cloud Console → **IAM & Admin → Service Accounts** →
   **Create service account**. Name it e.g. `mykabayan-robot`. Create → Done.
2. Open it → **Keys → Add key → Create new key → JSON** → a `.json` file
   downloads. Inside are `client_email` and `private_key` — you'll need both.
3. (Make sure the **Google Sheets API** is enabled for the project — one-time,
   APIs & Services → Enable APIs → "Google Sheets API".)

## 3. Share the sheet with the robot(s)

1. Open MYKabayan's sheet → **Share** → paste the robot's `client_email`
   (`mykabayan-robot@…iam.gserviceaccount.com`) → **Editor** → Send.
2. Also share the same sheet with your **master robot** (Profile B) as Editor, so
   your God Mode PC can see it.

## 4. Register the customer in God Mode

On your PC (Profile B), open the app → **God Mode → Add customer**:
- Business name: MYKabayan
- Allowed emails: their staff Google emails (comma-separated) — or their email domain
- Sheet link: paste MYKabayan's sheet URL → it's **validated** before saving.

(Or add a row directly in your Control sheet's `Tenants` tab — see `GODMODE_SETUP.md`.)

## 5. Set up their PC

1. Install **MYK Tracker Setup .exe** on the customer's PC (from `DESKTOP.md`).
2. Create `%APPDATA%\mykabayan-tracker\.env` using **Profile A** from `DESKTOP.md`,
   filled with:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` = mykabayan-robot's `client_email`
   - `GOOGLE_PRIVATE_KEY` = mykabayan-robot's `private_key` (keep the `\n`s)
   - `GOOGLE_SHEET_ID` = MYKabayan's sheet ID
   - the shared `NEXTAUTH_SECRET` / `GOOGLE_OAUTH_*` values
3. Launch the app → they **Sign in with Google** → they see only their data,
   branded and with the tabs you set for them.

## 6. Customize them (optional, anytime)

From your God Mode PC, **Switch** into MYKabayan, then Settings:
- **Design** — logo, colors, fonts, company name.
- **Tabs** — which tabs they see + rename them (e.g. "Bossing" → "Rexie/Analyn").
- **Pricing** — their gold MC, per-pc rates, USD→AED, etc.

Changes save to their sheet and apply on their PCs.

---

### Recap: what's one-time vs repeated
- **Build the installer:** once (rebuild only when the app itself changes).
- **This onboarding:** once per new customer.
- **Customer effort:** install once, sign in. That's it.
