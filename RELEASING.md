# Releasing Ken Tracker

## Every time you change something

```
.\release.bat "short description of the change"
```

That's it: version bump, GitHub push, desktop installer published (auto-update),
and Vercel web deploy.

Test first with `npm.cmd run dev` (http://localhost:3000) before releasing.

## One-time setup on a new PC

1. **GitHub token** (lets the build upload the installer)
   - github.com → your photo → Settings → Developer settings → Personal access
     tokens → Tokens (classic) → Generate new token (classic), scope **repo**.
   - In PowerShell: `setx GH_TOKEN "ghp_...your token..."`
   - Close and reopen VS Code so it picks it up.
2. **Electron binary** (if `npm install` skipped it):
   `node node_modules\electron\install.js`
3. **Vercel CLI login + link**
   - `npx vercel login`
   - `npx vercel link` → pick scope **ken-d66e**, project **ken-tracker**.
4. **Your own installed app's keys**: copy `.env.local` to
   `%APPDATA%\Ken Tracker\.env` (the desktop app reads keys from there).

Secrets never go in git: `.env*`, `key.json` and `.vercel/` are ignored.
