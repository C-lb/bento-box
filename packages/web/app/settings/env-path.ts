import path from "node:path";

// Where the user's keys live. The packaged app passes EE_ENV_FILE (the per-user
// .env that main.js loads at launch). In dev there is no Electron, so fall back
// to the repo-root .env (cwd is packages/web during `next dev`/`next start`).
export function envFilePath(): string {
  return process.env.EE_ENV_FILE ?? path.resolve(process.cwd(), "..", "..", ".env");
}
