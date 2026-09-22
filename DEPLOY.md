# Deploy to Vercel (the "central backend")

This puts one live copy of the app on a free web address (e.g.
`https://myk-tracker.vercel.app`). That address is your **kitchen**: it holds the
service-account key and decides which customer sees which sheet. Your future
desktop and mobile apps just point at it. You do this **once**; every customer
uses the same URL and always gets the latest version.

Time: ~30–45 min the first time. You need free accounts on **GitHub** and
**Vercel**, and your existing **Google Cloud** project.

---

## Step 0 — Rotate your keys first (important)

The keys in the old `.env.local` were exposed (committed in plain text), so treat
them as compromised. Before going live, generate fresh ones (see `SECURITY.md`):
new service-account key, reset the OAuth client secret, and a new
`NEXTAUTH_SECRET` (`openssl rand -base64 32`). Use the **new** values in Step 3.

## Step 1 — Put the code on GitHub

Easiest without a terminal: **GitHub Desktop**.

1. Install GitHub Desktop, sign in.
2. File → **Add Local Repository** → choose this `mykabayan-tracker` folder →
   when prompted, **create a repository** here.
3. Make it **Private**.
4. Click **Publish repository**.

`node_modules`, `.next`, and `.env.local` are already git-ignored, so your secrets
and huge folders are **not** uploaded — good.

## Step 2 — Import into Vercel

1. Go to vercel.com → sign in **with GitHub**.
2. **Add New… → Project** → pick your `mykabayan-tracker` repo → **Import**.
3. Framework is auto-detected as **Next.js**. Leave build settings default
   (Build: `next build`, Install: `npm install`). Don't deploy yet — set env
   vars first (Step 3), or deploy once and add them right after.

## Step 3 — Set environment variables (Vercel → Project → Settings → Environment Variables)

Add each of these (Environment: **Production**, and also **Preview** if you want
test deploys to work):

| Name | Value / notes |
|------|----------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Your service account email |
| `GOOGLE_PRIVATE_KEY` | The **new** private key. Paste it exactly as in `.env.local` — in quotes, with the `\n` sequences. The app converts them. |
| `NEXTAUTH_SECRET` | The **new** random string |
| `GOOGLE_OAUTH_CLIENT_ID` | From Google Cloud → Credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The **new** OAuth secret |
| `NEXTAUTH_URL` | Your Vercel URL, e.g. `https://myk-tracker.vercel.app` (fill in after first deploy gives you the URL, then redeploy) |
| `CONTROL_SHEET_ID` | Your master Control sheet ID (multi-tenant). Leave blank to run single-tenant. |
| `DEVELOPER_EMAILS` | Your God Mode email(s), pipe-separated |
| `GOOGLE_SHEET_ID` | Single-tenant fallback sheet (used only if `CONTROL_SHEET_ID` is blank) |

## Step 4 — Point Google Sign-In at the live URL (the #1 gotcha)

In Google Cloud Console → **APIs & Services → Credentials** → your **OAuth 2.0
Client ID** (Web application):

- **Authorized JavaScript origins:** add `https://<your-app>.vercel.app`
- **Authorized redirect URIs:** add
  `https://<your-app>.vercel.app/api/auth/callback/google`

Save. (Keep the `http://localhost:3000` entries too, for local dev.)

If you skip this you'll get **"Error 400: redirect_uri_mismatch"** on sign-in.

## Step 5 — Set NEXTAUTH_URL and redeploy

After the first deploy, copy your real URL, put it in `NEXTAUTH_URL` (Step 3),
then Vercel → **Deployments → … → Redeploy** so the new value takes effect.

## Step 6 — Share the sheets with the service account

Every sheet the app touches must be shared as **Editor** with your
`GOOGLE_SERVICE_ACCOUNT_EMAIL`:
- The **Control** sheet.
- **Each customer's** data sheet.

(See `GODMODE_SETUP.md` for the Control sheet's `Tenants` tab layout.)

## Step 7 — First login & verify

1. Open your Vercel URL, **Sign in with Google** using a `DEVELOPER_EMAILS`
   account → you should land in the app with a **God Mode** tab.
2. God Mode → **Add customer** (or add rows to the Control sheet), paste a sheet
   link — it's validated before saving.
3. **Switch** into a customer → confirm their data loads and Settings → Connection
   check is green.

---

## Updating later

Change code → commit/push in GitHub Desktop → Vercel **auto-deploys** in ~1–2 min.
No reinstalling anything on customer machines.

## Troubleshooting

- **redirect_uri_mismatch** → Step 4 redirect URI doesn't exactly match your URL.
- **"GOOGLE_PRIVATE_KEY is not set"** → env var missing/misnamed, or you deployed
  before adding it (redeploy after adding).
- **Access Denied after login** → that email isn't a developer and isn't in any
  customer's Roles sheet / allowed emails.
- **"No workspace is assigned to your account"** → the email isn't matched to any
  active tenant in the Control sheet.
- **Build fails on Vercel** → check the build log; run `npm run build` locally
  first to catch it (this repo's `tsc --noEmit` is clean).

## Note

`run-app.bat` / `stop-app.bat` are local-only launchers for running on your own PC
— they're irrelevant to Vercel and will be replaced by the desktop installer later.
