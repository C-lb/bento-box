# Desktop app setup

The desktop build packages Event Editor as a native application for macOS and Windows.

## Keys file location

On first launch, the app creates a template keys file in your user data folder. Fill in the required API credentials, then relaunch the app.

- **macOS:** `~/Library/Application Support/Event Editor/.env`
- **Windows:** `%APPDATA%\Event Editor\.env`

The template includes placeholders for:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GROQ_API_KEY`
- `ANTHROPIC_API_KEY`
- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`

Edit the file with your actual credentials (see respective setup docs for how to obtain them). The app reads this file on startup.

## OAuth redirect URIs

Before using the app, register these redirect URIs in each OAuth provider's console. You only need to do this once per environment.

### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project and open **APIs & Services > Credentials**.
3. Find your OAuth 2.0 Client (the web application credential).
4. Add this redirect URI to the authorized list:
   - `http://127.0.0.1:4571/api/google/callback`
5. Keep the existing dev URIs (`http://localhost:3000`) intact.

### Canva

1. Go to [Canva Developer Portal](https://www.canva.com/developers).
2. Select your Connect integration.
3. Add this redirect URI:
   - `http://127.0.0.1:4571/api/canva/callback`
4. Keep the existing dev URIs (`http://127.0.0.1:3000`) intact.

## First-run unsigned-app steps

The first time you launch the app, your OS will block it as an unsigned binary. Approve the launch using these steps.

### macOS

1. Right-click the Event Editor app in Finder.
2. Select **Open**.
3. Click **Open** again in the confirmation dialog (Gatekeeper).

The app launches. Future launches will not show this dialog.

### Windows

1. Run the Event Editor installer.
2. If SmartScreen appears with "Windows Defender SmartScreen prevented an unrecognized app from starting", click **More info**.
3. Click **Run anyway**.

The app launches. Future launches will not show this dialog.

## Data location

All application data (database, rendered headshots, thumbnails) is stored in your user data folder under `Event Editor/data/`. This folder is private to your user account.

- **macOS:** `~/Library/Application Support/Event Editor/data/`
- **Windows:** `%APPDATA%\Event Editor\data\`

To reset the app to a clean state, delete this folder. The app will recreate it on the next launch.

## Cutting a release

Releases are published via GitHub Actions. To get the latest build for your OS:

1. Push a git tag matching `v*` (e.g., `v0.1.0`, `v1.0.0-beta.1`) to the repository.
2. GitHub Actions automatically builds and releases:
   - macOS: `.dmg` (installer) and `.zip` (portable)
   - Windows: `.exe` (installer)
3. Download the appropriate file for your OS from the GitHub releases page.

## Port note

The app uses a local loopback port (`127.0.0.1:4571`) for its built-in web server. If the app fails to start with a message about the port being busy, another application is using port 4571. Close that application and relaunch the Event Editor app.

To manually check if port 4571 is in use, run:

- **macOS/Linux:** `lsof -i :4571`
- **Windows (PowerShell):** `netstat -ano | findstr :4571`
