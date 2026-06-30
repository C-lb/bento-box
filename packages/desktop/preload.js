// packages/desktop/preload.js
// The renderer talks to the local server over HTTP, so almost no IPC is needed.
// The one bridge: let the Settings page restart the app after saving API keys,
// so the forked server reloads the rewritten per-user .env. Sandbox-safe.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ee", {
  relaunch: () => ipcRenderer.invoke("ee:relaunch"),
});
