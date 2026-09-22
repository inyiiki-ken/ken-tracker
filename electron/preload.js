// Minimal preload. contextIsolation is on and nodeIntegration off, so the web
// app runs with no direct Node access. Add a small, explicit bridge here later
// if the UI ever needs a native capability (e.g. "reveal file", printing).
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mykDesktop", {
  isDesktop: true,
  version: process.versions.electron,
});
