# Bento Box

A box of small tools for events, images, media, and documents, packaged as a desktop app for macOS and Windows.

## Download the desktop app

No build tools needed. Everything is on the [Releases page](https://github.com/C-lb/bento-box/releases/latest).

### macOS (Apple silicon)

1. Open the [latest release](https://github.com/C-lb/bento-box/releases/latest).
2. Under **Assets**, download `Bento.Box-<version>-arm64.dmg`.
3. Open the downloaded `.dmg` and drag **Bento Box** into **Applications**.
4. First launch only: macOS blocks unsigned apps. Right-click the app in Applications and choose **Open**, then **Open** again in the dialog. If macOS still refuses, go to **System Settings > Privacy & Security**, scroll down, and click **Open Anyway** next to the Bento Box message, then launch it again.
5. Later launches open normally.

The `.zip` asset is the same app without an installer, for people who prefer to unzip and move it themselves. Intel Macs are not supported.

### Windows

1. Open the [latest release](https://github.com/C-lb/bento-box/releases/latest).
2. Under **Assets**, download `Bento.Box.Setup.<version>.exe` (the installer). The plain `Bento.Box.<version>.exe` is a portable version that runs without installing.
3. Run the installer. If SmartScreen shows "Windows protected your PC", click **More info**, then **Run anyway**.
4. Later launches open normally.

### After installing

On first launch the app creates a keys file for API credentials and tells you where it lives. Setup details (keys, OAuth redirect URIs, data location): see [`docs/setup/desktop.md`](docs/setup/desktop.md).

## Keyboard shortcuts

`Cmd` on macOS, `Ctrl` on Windows.

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+1` | Go to Tools (home) |
| `Cmd/Ctrl+2` | Go to Workflow |
| `Cmd/Ctrl+,` | Open Settings |
| `Cmd/Ctrl+K` or `/` | Focus the tool search |
| `Cmd/Ctrl+[` / `Cmd/Ctrl+]` | Back / forward |
| `Cmd/Ctrl+0` | Reset zoom |
| `Cmd/Ctrl++` / `Cmd/Ctrl+-` | Zoom in / out |
| `Cmd/Ctrl+R` | Reload |

## Development

### Environment

All API keys live in the repo-root `.env` (gitignored). `next.config.ts` loads it
via `@next/env`, so `npm run dev` / `npm run build` pick it up regardless of cwd.
No per-package `.env` is needed.

### Tools

#### Headshot Studio

Canva renderer setup: see `docs/setup/canva.md`.

Batch from a sheet: see `docs/setup/sheets.md`.
