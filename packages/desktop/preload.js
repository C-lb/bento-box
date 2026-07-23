// packages/desktop/preload.js
// The renderer talks to the local server over HTTP, so almost no IPC is needed.
// Two bridges: let the Settings page restart the app after saving API keys (so
// the forked server reloads the rewritten per-user .env), and deliver menu
// shortcut navigation (Cmd/Ctrl+1/2, Settings) to the client router. Sandbox-safe.
const { contextBridge, ipcRenderer } = require("electron");

// One underlying listener; last registration wins, so a React effect re-running
// never stacks duplicate handlers.
let navHandler = null;
ipcRenderer.on("ee:nav", (_e, path) => navHandler?.(path));

contextBridge.exposeInMainWorld("ee", {
  relaunch: () => ipcRenderer.invoke("ee:relaunch"),
  onNav: (cb) => {
    navHandler = cb;
  },
});
