// packages/desktop/main.js
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { fork } = require("node:child_process");

// Force the app name so userData resolves to ".../Application Support/Bento"
// (the package name "@event-editor/desktop" would otherwise create an ugly nested
// folder and not match the setup docs). Must run before any app.getPath("userData").
// Note: renamed from "Event Editor" — packaged installs get a fresh data dir once.
app.setName("Bento");
const { readFileSync, mkdirSync, existsSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { resolveDirs } = require("./lib/dirs.js");
const { readPid, writePid, clearPid, isAlive } = require("./lib/pidfile.js");

const HOST = "127.0.0.1";
const PORT = 4571;
const BASE = `http://${HOST}:${PORT}`;

let serverProc = null;
let quitting = false;

// --- per-user env -----------------------------------------------------------
function loadDotEnv(file) {
  if (!existsSync(file)) {
    writeFileSync(
      file,
      [
        "# event-editor keys - fill these in. No quotes needed.",
        "GOOGLE_CLIENT_ID=",
        "GOOGLE_CLIENT_SECRET=",
        "GROQ_API_KEY=",
        "ANTHROPIC_API_KEY=",
        "CANVA_CLIENT_ID=",
        "CANVA_CLIENT_SECRET=",
        "",
      ].join("\n"),
    );
    return {};
  }
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function serverEnv() {
  const userData = app.getPath("userData");
  const { dataDir, binDir } = resolveDirs(process.env, userData);
  mkdirSync(dataDir, { recursive: true });
  const envFile = path.join(userData, ".env");
  const keys = loadDotEnv(envFile);
  const fontPath = app.isPackaged
    ? path.join(process.resourcesPath, "server", "packages", "web", "assets", "fonts", "DMSans-Medium.ttf")
    : path.join(__dirname, "build", "server", "packages", "web", "assets", "fonts", "DMSans-Medium.ttf");
  // Setup-code preset source: packaged builds carry a baked preset.env in
  // Resources (assemble-server.mjs writes it); without this the settings code
  // has no keys to fill from once the app leaves the dev machine. An external
  // EE_PRESET_ENV still wins.
  const bakedPreset = app.isPackaged
    ? path.join(process.resourcesPath, "preset.env")
    : path.join(__dirname, "build", "preset.env");
  const presetEnv = process.env.EE_PRESET_ENV ?? (existsSync(bakedPreset) ? bakedPreset : null);
  return {
    ...process.env,
    ...keys,
    EE_ENV_FILE: envFile, // the in-app Settings key form writes back to this file
    EE_DB_PATH: path.join(dataDir, "app.db"),
    EE_HEADSHOT_DIR: path.join(dataDir, "headshots"),
    EE_THUMBS_DIR: path.join(dataDir, "thumbs"),
    EE_DATA_DIR: dataDir,
    EE_BIN_DIR: binDir,
    EE_FONT_PATH: fontPath,
    EE_APP_VERSION: app.getVersion(),
    ...(presetEnv ? { EE_PRESET_ENV: presetEnv } : {}),
    EE_PUBLIC_URL: BASE,
    PORT: String(PORT),
    HOSTNAME: HOST,
  };
}

// --- server lifecycle -------------------------------------------------------
function serverRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "build", "server");
}

function runMigrations(env) {
  return new Promise((resolve, reject) => {
    const migrate = path.join(serverRoot(), "node_modules", "@event-editor", "core", "dist", "migrate.js");
    const p = fork(migrate, [], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`migrate exited ${code}`))));
  });
}

function pidFilePath() {
  return path.join(app.getPath("userData"), "server.pid");
}

// Reclaim the port from a previous instance's server. The pid file tells us
// whose it is; anything else on the port is genuinely not ours to kill.
async function killStaleServer() {
  const pid = readPid(pidFilePath());
  if (!pid || pid === process.pid || !isAlive(pid)) return;
  try { process.kill(pid); } catch {}
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await portInUse())) { clearPid(pidFilePath()); return; }
    await new Promise((r) => setTimeout(r, 250));
  }
  try { process.kill(pid, "SIGKILL"); } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (!(await portInUse())) clearPid(pidFilePath());
}

function startServer(env) {
  const entry = path.join(serverRoot(), "packages", "web", "server.js");
  serverProc = fork(entry, [], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" });
  writePid(pidFilePath(), serverProc.pid);
  serverProc.on("error", (err) => {
    if (quitting) return;
    dialog.showErrorBox("event-editor server stopped", `Server process error: ${err.message}`);
    app.quit();
  });
  serverProc.on("exit", (code) => {
    clearPid(pidFilePath());
    if (quitting) return;
    if (code === 0 || code === null) return; // null = killed by signal during normal shutdown
    dialog.showErrorBox("event-editor server stopped", `Server exited unexpectedly (code ${code}).`);
    app.quit();
  });
}

function waitForPort(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(PORT, HOST);
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("server did not start"));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

function portInUse() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(PORT, HOST);
  });
}

// --- window -----------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, nodeIntegration: false },
  });
  win.loadURL(BASE);
}

async function boot() {
  const devUrl = process.env.EE_DESKTOP_DEV_URL;
  if (devUrl) {
    // dev: assume `npm run dev` is already serving; just open a window on it.
    new BrowserWindow({ width: 1200, height: 820, webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, nodeIntegration: false } }).loadURL(devUrl);
    return;
  }
  if (await portInUse()) {
    // Usually our own orphan: Settings relaunch used app.exit (skips
    // before-quit) or a crash left the server behind. Reclaim, then re-check.
    await killStaleServer();
  }
  if (await portInUse()) {
    dialog.showErrorBox("event-editor", `Port ${PORT} is already in use. Close whatever is using it and relaunch.`);
    app.quit();
    return;
  }
  const env = serverEnv();
  await runMigrations(env);
  startServer(env);
  await waitForPort();
  createWindow();
}

// The renderer's Settings page calls window.ee.relaunch() after saving keys, so
// the forked server reboots and picks up the rewritten per-user .env.
// app.exit() skips before-quit, so kill the server here and wait for it to die
// or the relaunched instance finds the port taken (the "Port 4571 is already in
// use" loop). The boot-time killStaleServer() is the belt to this suspender.
ipcMain.handle("ee:relaunch", () => {
  quitting = true;
  const finish = () => { app.relaunch(); app.exit(0); };
  if (serverProc && serverProc.exitCode === null && !serverProc.killed) {
    const fallback = setTimeout(finish, 3000);
    serverProc.once("exit", () => { clearTimeout(fallback); finish(); });
    serverProc.kill();
  } else {
    finish();
  }
});

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox("event-editor failed to start", String(e && e.stack ? e.stack : e));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { quitting = true; if (serverProc) serverProc.kill(); });
