# Auto-Update Setup (Ken Tracker)

The app now updates itself like a game patch: on launch it checks GitHub for a
newer version, downloads only the changed parts in the background, and offers to
restart to apply it. **Clients never reinstall again.**

You do this setup **once**. After that, shipping an update is a single command.

---

## One-time setup

### 1. Make a free GitHub account
Go to https://github.com and sign up. (This is only a file store for the patch
files — your app stays a native install. Clients never see GitHub.)

### 2. Create a PUBLIC repository named `ken-tracker`
- Click **New repository**.
- Name it exactly **`ken-tracker`**.
- Set it to **Public** (so the installed apps can download updates without a login).
- You do **not** need to upload any code — it just holds the release files.

### 3. Point the app at your GitHub
In `package.json`, find this block and replace `YOUR_GITHUB_USERNAME` with your
actual GitHub username:

```json
"publish": [
  { "provider": "github", "owner": "YOUR_GITHUB_USERNAME", "repo": "ken-tracker", "releaseType": "release" }
]
```

### 4. Create an access token (lets you upload releases)
- GitHub → your photo (top-right) → **Settings** → **Developer settings** →
  **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
- Give it the **`repo`** scope. Generate it and **copy the token** (starts with `ghp_`).
- Keep it somewhere safe — you paste it before each release.

### 5. Install the new dependency (once)
In the project folder:

```
npm install
```

---

## Shipping an update (every time you change something)

1. Bump the version in `package.json` (e.g. `0.2.0` → `0.2.1` → `0.3.0`). **Higher every time.**
2. In PowerShell (as Administrator), in the project folder:

```powershell
$env:GH_TOKEN="ghp_your_token_here"
npm run release:win
```

That builds the app and uploads it to your GitHub Releases automatically.

3. Done. Every installed Ken Tracker (on your PCs and your clients') will pick up
   the update the next time it launches, download it quietly, and offer a
   **"Restart now"** button.

---

## Important notes

- **This 0.2.0 build is the first update-capable version.** The `0.1.0` currently
  installed does NOT know how to auto-update. So install `0.2.0` by hand **one
  last time** on each machine — from then on, every future version patches itself.
- Updates are **differential** — only changed bytes download, so patches are small/fast.
- First-ever install may show a Windows "unknown publisher" warning (no paid
  signing certificate). Auto-updates after that are silent.
- To review a release before it reaches clients, change `"releaseType": "release"`
  to `"draft"` — then you manually click **Publish** on GitHub when ready.
