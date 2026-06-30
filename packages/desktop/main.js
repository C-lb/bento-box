// packages/desktop/main.js
const { app, BrowserWindow, dialog } = require("electron");
const { fork } = require("node:child_process");
const { readFileSync, mkdirSync, existsSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const net = require("node:net");

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
  const dataDir = path.join(userData, "data");
  mkdirSync(dataDir, { recursive: true });
  const keys = loadDotEnv(path.join(userData, ".env"));
  const fontPath = app.isPackaged
    ? path.join(process.resourcesPath, "server", "packages", "web", "assets", "fonts", "DMSans-Medium.ttf")
    : path.join(__dirname, "build", "server", "packages", "web", "assets", "fonts", "DMSans-Medium.ttf");
  return {
    ...process.env,
    ...keys,
    EE_DB_PATH: path.join(dataDir, "app.db"),
    EE_HEADSHOT_DIR: path.join(dataDir, "headshots"),
    EE_THUMBS_DIR: path.join(dataDir, "thumbs"),
    EE_FONT_PATH: fontPath,
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

function startServer(env) {
  const entry = path.join(serverRoot(), "packages", "web", "server.js");
  serverProc = fork(entry, [], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" });
  serverProc.on("error", (err) => {
    if (quitting) return;
    dialog.showErrorBox("event-editor server stopped", `Server process error: ${err.message}`);
    app.quit();
  });
  serverProc.on("exit", (code) => {
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

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox("event-editor failed to start", String(e && e.stack ? e.stack : e));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { quitting = true; if (serverProc) serverProc.kill(); });
