# Phone App (PWA) — Deploy to Vercel (free)

This puts the app online so phones can install it. Your PCs keep using the native
installer — nothing there changes. Do this once; after that, updates are one command.

---

## Step 1 — Install the Vercel tool (once)

In PowerShell:

```powershell
npm install -g vercel
```

## Step 2 — Log in

```powershell
vercel login
```
Pick "Continue with GitHub" (you already have an account) or email, and approve in the browser.

## Step 3 — First deploy (creates the project)

In the project folder:

```powershell
cd C:\Users\lpaul\Downloads\mykabayan-tracker
vercel
```
Answer the prompts:
- Set up and deploy? **Y**
- Which scope? **your account**
- Link to existing project? **N**
- Project name? **ken-tracker** (or press Enter)
- Directory? **./** (press Enter)
- Override settings? **N** (it auto-detects Next.js)

It builds and gives you a preview URL. Copy the base address — it'll look like
`https://ken-tracker-xxxx.vercel.app`.

## Step 4 — Add your settings (environment variables)

Go to **vercel.com → your `ken-tracker` project → Settings → Environment Variables.**

Add each of these (the values are the same ones in your `.env.local` file):

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | (from .env.local) |
| `GOOGLE_PRIVATE_KEY` | (from .env.local — paste the whole thing) |
| `GOOGLE_SHEET_ID` | (from .env.local) |
| `CONTROL_SHEET_ID` | (from .env.local) |
| `DEVELOPER_EMAILS` | (from .env.local) |
| `NEXTAUTH_SECRET` | (from .env.local) |
| `GOOGLE_OAUTH_CLIENT_ID` | (from .env.local) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | (from .env.local) |
| `NEXTAUTH_URL` | **your Vercel URL** (e.g. `https://ken-tracker.vercel.app`) — NOT localhost |

Tip: Vercel lets you **paste your whole `.env.local` at once** (there's an import/paste
box). If you do that, just **fix `NEXTAUTH_URL`** afterward to your Vercel address.
Set them for the **Production** environment.

## Step 5 — Tell Google to allow the new address

Google Cloud Console → **APIs & Services → Credentials → your OAuth 2.0 Client**:
- Under **Authorized redirect URIs**, add:
  `https://YOUR-VERCEL-URL/api/auth/callback/google`
- Under **Authorized JavaScript origins**, add:
  `https://YOUR-VERCEL-URL`
- **Save.** (Leave your existing `localhost:34567` entries — the desktop app still needs them.)

## Step 6 — Publish for real

```powershell
vercel --prod
```
Open the production URL in your phone's browser to confirm it loads and you can log in.

---

## Installing it on a phone

- **Android (Chrome):** open the URL → menu (⋮) → **Add to Home screen** / **Install app**.
- **iPhone (Safari):** open the URL → Share button → **Add to Home Screen**.

It gets a **Ken Tracker** icon and opens fullscreen like a normal app.

---

## Shipping updates later

Whenever you change something, from the project folder:

```powershell
vercel --prod
```
Every phone gets the update instantly on next open — no reinstall. (This is separate
from the desktop `.exe` updates, which still go through `npm run release:win`.)
