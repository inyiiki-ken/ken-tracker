// Electron main process. Boots the Next.js standalone server hidden (no
// terminal window) and shows the app in a native window. Packaged with
// electron-builder into a normal Windows installer.

const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const PORT = Number(process.env.MYK_PORT || 34567); // fixed so the Google OAuth
// redirect URI (http://localhost:34567/api/auth/callback/google) is stable.
const isDev = !app.isPackaged;
let serverProc = null;

/**
 * Load configuration/secrets from a .env file so customers/you can update keys
 * WITHOUT rebuilding the installer. Search order:
 *   1) %APPDATA%/Ken Tracker/.env   (editable per machine after install)
 *   2) <resources>/.env            (bundled default shipped in the installer)
 *   3) project .env.local          (dev only)
 */
function loadEnv() {
  // Order = priority (first file to set a key wins). The BUNDLED config that
  // ships inside the installer is authoritative, so a stale leftover .env in
  // %APPDATA% can never override it and break the app. The per-machine file is
  // still read afterwards to FILL any keys the bundle didn't provide.
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : null, // bundled = authoritative
    path.join(app.getPath("userData"), ".env"),                              // per-machine (fills gaps only)
    isDev ? path.join(__dirname, "..", ".env.local") : null,                 // dev only
  ].filter(Boolean);

  const loadedFrom = [];
  const sources = {}; // key -> file it was first taken from
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      loadedFrom.push(file);
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) { process.env[key] = val; sources[key] = file; }
      }
    } catch (e) {
      console.error("env load failed for", file, e);
    }
  }
  return { checked: candidates, loadedFrom, sources };
}

/** Writes a startup diagnostic and, if required config is missing, shows a clear
 * dialog naming what's missing (instead of the cryptic NextAuth "server error"). */
function checkConfig(envInfo) {
  const required = [
    "NEXTAUTH_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (!process.env.GOOGLE_SHEET_ID && !process.env.CONTROL_SHEET_ID) {
    missing.push("GOOGLE_SHEET_ID (or CONTROL_SHEET_ID)");
  }

  const userDataEnv = path.join(app.getPath("userData"), ".env");
  const sources = envInfo.sources || {};
  // Mask a secret/id: show length + first 6 + last 4 so we can spot a wrong or
  // truncated value without leaking the whole thing.
  const mask = (v) => (v ? `len=${v.length} [${v.slice(0, 6)}…${v.slice(-4)}]` : "MISSING");
  const controlId = process.env.CONTROL_SHEET_ID || "";
  const log = [
    `Ken Tracker startup ${new Date().toISOString()}`,
    `userData: ${app.getPath("userData")}`,
    `Put your .env here: ${userDataEnv}`,
    `.env files checked:`,
    ...envInfo.checked.map((f) => `  - ${f} ${envInfo.loadedFrom.includes(f) ? "(loaded)" : "(not found)"}`),
    `Effective config (which file each value came from):`,
    `  - CONTROL_SHEET_ID: ${mask(controlId)}  from ${sources.CONTROL_SHEET_ID || "-"}`,
    `  - GOOGLE_SHEET_ID: ${mask(process.env.GOOGLE_SHEET_ID)}  from ${sources.GOOGLE_SHEET_ID || "-"}`,
    `  - GOOGLE_SERVICE_ACCOUNT_EMAIL: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "MISSING"}  from ${sources.GOOGLE_SERVICE_ACCOUNT_EMAIL || "-"}`,
    `  - GOOGLE_PRIVATE_KEY: ${process.env.GOOGLE_PRIVATE_KEY ? `len=${process.env.GOOGLE_PRIVATE_KEY.length}` : "MISSING"}  from ${sources.GOOGLE_PRIVATE_KEY || "-"}`,
    `Required keys present:`,
    ...required.map((k) => `  - ${k}: ${process.env[k] ? "yes" : "MISSING"}`),
  ].join("\n");

  try { fs.writeFileSync(path.join(app.getPath("userData"), "startup.log"), log); } catch {}

  if (missing.length && envInfo.loadedFrom.length === 0) {
    dialog.showErrorBox(
      "Configuration needed",
      `The app has no configuration yet.\n\nCreate a file named  .env  here:\n${userDataEnv}\n\n` +
      `and put your keys in it (see DESKTOP.md). Missing: ${missing.join(", ")}.`
    );
  } else if (missing.length) {
    dialog.showErrorBox(
      "Configuration incomplete",
      `Your .env was found but is missing: ${missing.join(", ")}.\n\n` +
      `Edit:\n${envInfo.loadedFrom[0]}\n\nA log was written to:\n${path.join(app.getPath("userData"), "startup.log")}`
    );
  }
}

function serverEntry() {
  // Standalone build entry, bundled under resources/app/server.js.
  if (isDev) return path.join(__dirname, "..", ".next", "standalone", "server.js");
  return path.join(process.resourcesPath, "app", "server.js");
}

function startServer() {
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    // Broken install: try to repair by pulling the newest release first.
    rescueUpdate(`Could not find the app server at:\n${entry}`);
    return false;
  }
  // Run the Next server using Electron's bundled Node (ELECTRON_RUN_AS_NODE),
  // so customers don't need Node installed. windowsHide hides any console.
  serverProc = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry), // standalone server expects to run from its own dir
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      // NextAuth must match THIS app's origin. Force the desktop port so a
      // NEXTAUTH_URL copied from a dev/hosted .env (e.g. :3000) can't cause a
      // redirect_uri_mismatch.
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => console.log("[next]", String(d).trim()));
  serverProc.stderr.on("data", (d) => console.error("[next]", String(d).trim()));
  serverProc.on("exit", (code) => console.log("[next] exited", code));
  return true;
}

/**
 * SELF-REPAIR. If this version can't start (missing/broken app files), don't
 * just quit — that would leave the PC stuck on a broken version forever,
 * because the normal updater only runs once the app window is open. Instead
 * download the newest release from GitHub and install it automatically.
 */
function rescueUpdate(reason) {
  const fail = (extra) => {
    dialog.showErrorBox(
      "Ken Tracker can't start",
      `${reason}\n\n${extra}\n\nPlease reinstall Ken Tracker from the latest installer.`
    );
    app.quit();
  };
  if (isDev) return fail("(development build)");
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return fail("Updater not available."); }
  const logUpd = (msg) => {
    try { fs.appendFileSync(path.join(app.getPath("userData"), "startup.log"), `\n[rescue] ${msg}`); } catch {}
  };
  logUpd(reason);
  const splash = new BrowserWindow({
    width: 420, height: 160, frame: false, resizable: false, backgroundColor: "#151413", show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
    '<body style="margin:0;font-family:Segoe UI,Arial;background:#151413;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">' +
    '<div><b>Ken Tracker is repairing itself…</b><br><small style="color:#aaa">Downloading the latest version. This can take a minute.</small></div></body>'
  ));
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-not-available", () => { logUpd("no newer version"); try { splash.close(); } catch {} fail("No newer version is available yet."); });
  autoUpdater.on("error", (err) => { logUpd(`error: ${err}`); try { splash.close(); } catch {} fail(`Update failed: ${err}`); });
  autoUpdater.on("update-downloaded", (info) => {
    logUpd(`installing ${info.version}`);
    try { autoUpdater.quitAndInstall(true, true); } catch (e) { fail(`Install failed: ${e}`); }
  });
  autoUpdater.checkForUpdates().catch((e) => { try { splash.close(); } catch {} fail(`Update failed: ${e}`); });
}

function waitForServer(onReady, tries = 0) {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/" }, () => onReady());
  req.on("error", () => {
    if (tries > 80) return rescueUpdate("The app server did not start in time.");
    setTimeout(() => waitForServer(onReady, tries + 1), 400);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    show: false,
    backgroundColor: "#151413",
    title: "Ken Tracker",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());

  // Open external links (e.g. Google sign-in, invoices) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${PORT}`) || url.startsWith(`http://127.0.0.1:${PORT}`)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`http://localhost:${PORT}`);
  setupAutoUpdate(win);
}

/**
 * Auto-update (like a game patch). On a packaged build, checks GitHub Releases
 * for a newer version, downloads only the changed parts in the background, and
 * offers to restart to apply it. Never blocks or breaks startup if it fails
 * (e.g. offline) — the app just runs the current version.
 */
function setupAutoUpdate(win) {
  if (isDev) return; // dev runs from source, nothing to update
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return; // dependency missing — skip silently
  }
  const logUpd = (msg) => {
    try { fs.appendFileSync(path.join(app.getPath("userData"), "startup.log"), `\n[update] ${msg}`); } catch {}
  };
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", (err) => logUpd(`error: ${err}`));
    autoUpdater.on("update-available", (info) => logUpd(`update available: ${info.version}`));
    autoUpdater.on("update-not-available", () => logUpd("up to date"));
    autoUpdater.on("update-downloaded", (info) => {
      const choice = dialog.showMessageBoxSync(win, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `Ken Tracker ${info.version} is ready to install.`,
        detail: "Restart to apply the update. Your data is safe.",
      });
      if (choice === 0) { try { autoUpdater.quitAndInstall(); } catch (e) { logUpd(`install failed: ${e}`); } }
    });
    autoUpdater.checkForUpdatesAndNotify();
    // Re-check every 6 hours for apps left open a long time.
    setInterval(() => { try { autoUpdater.checkForUpdates(); } catch {} }, 6 * 60 * 60 * 1000);
  } catch (e) {
    logUpd(`setup failed: ${e}`);
  }
}

app.whenReady().then(() => {
  const envInfo = loadEnv();
  checkConfig(envInfo);
  if (startServer() === false) return; // repairing itself
  waitForServer(createWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProc) try { serverProc.kill(); } catch {}
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProc) try { serverProc.kill(); } catch {}
});
