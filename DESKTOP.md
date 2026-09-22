# Desktop app (native installer, no terminal)

This packages the app as a normal Windows program: your customers double-click an
installer, get a desktop/Start-menu icon, and it opens in its own window. The
Next.js server runs **hidden** in the background — no console, nothing scary.

You (the developer) build the installer **once** on your PC with a couple of
commands; customers only ever run the finished installer.

---

## How it works

`electron/main.js` starts the app's server on `http://localhost:34567` with the
window hidden, waits for it, then shows the app in a native Electron window.
`electron-builder` wraps that into a Windows installer (`.exe`).

## Build the installer (on your Windows PC)

```bash
npm install            # first time only (downloads Electron — a few hundred MB)
npm run dist:win       # builds Next (standalone) + packages the installer
```

Output lands in `dist/`:  **`MYK Tracker Setup 0.1.0.exe`** — that's what you give
customers.

Handy scripts:
- `npm run electron:dev` — build + launch the desktop app locally to test it.
- `npm run build:desktop` — just the Next standalone build (no packaging).

## Configure secrets (the `.env` file) — two profiles

**Same installer for everyone.** What differs is the `.env` file you place on each
machine. The app reads it at runtime (so you can change keys without rebuilding),
from:

```
%APPDATA%\mykabayan-tracker\.env
```

(`C:\Users\<name>\AppData\Roaming\mykabayan-tracker\.env`. If unsure, the app's
"Configuration needed" dialog prints the exact path.)

### Profile A — a customer's PC (single sheet, their own key)
Locked to that customer's sheet with a robot key that can open **only** their
sheet. No God Mode. Use this on every customer machine:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=mykabayan-robot@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...their robot key...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=<this customer's sheet id>
NEXTAUTH_SECRET=<any long random string>
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# no CONTROL_SHEET_ID, no DEVELOPER_EMAILS  -> single-tenant, this sheet only
# NEXTAUTH_URL is set automatically to http://localhost:34567
```

### Profile B — your PC (God Mode master)
Sees and manages all customers. Uses your **master** robot (shared on every
customer sheet) + the Control sheet:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=master-robot@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...master key...\n-----END PRIVATE KEY-----\n"
CONTROL_SHEET_ID=<your control sheet id>
DEVELOPER_EMAILS=you@gmail.com
NEXTAUTH_SECRET=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

See `ONBOARDING.md` for the click-by-click of adding a new customer (make sheet,
make robot, share, drop in `.env`).

## Google Sign-In on desktop — read this

Google restricts OAuth inside embedded app windows, so sign-in needs the fixed
local address registered. In Google Cloud → Credentials → your OAuth client add:
- **Authorized redirect URI:** `http://localhost:34567/api/auth/callback/google`
- **Authorized JavaScript origin:** `http://localhost:34567`

If Google still blocks the in-window login ("disallowed_useragent"), we switch the
desktop app to sign in via the system browser, or to a simpler email login checked
against the Roles sheet — tell me and I'll wire whichever you prefer (see the
question I asked in chat).

## Icon (optional)

Drop a `build/icon.ico` (256×256) and electron-builder uses it for the app +
installer automatically.

---

## Updates (manual, for now)

When you change the app, rebuild the installer (`npm run dist:win`) and run the
new installer on each PC — it upgrades in place, data is untouched (data lives in
Google Sheets, not in the app). When you're ready for "auto-update like a game,"
say so and I'll add a self-updater (it needs a small place to host the update
files).

## Why per-customer keys are safe here

Each customer's PC (Profile A) carries a robot key shared on **only their own
sheet**, so even if that key is copied off their machine it opens nothing but
their own data. Your master key (Profile B) never leaves your PC. Still needs
internet, since the data lives in Google Sheets.
