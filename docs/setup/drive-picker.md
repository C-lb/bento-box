# Google Drive picker setup

The slice tool's "Choose from Drive" button uses the native Google Picker. It needs
two values from the same Google Cloud project your OAuth client already lives in.

## 1. Enable the Picker API
Google Cloud Console -> APIs & Services -> Library -> search "Google Picker API" -> Enable.

## 2. Create a browser API key
APIs & Services -> Credentials -> Create credentials -> API key. Restrict it to the
Picker API (Application restrictions: HTTP referrers -> add your app origin, e.g.
`http://localhost:3000/*`). Copy the key.

## 3. Find the project number
Cloud Console home / project settings -> "Project number" (a long integer). This is
the picker App ID.

## 4. Set env vars (root `.env`)
```
GOOGLE_PICKER_API_KEY=your_browser_api_key
GOOGLE_PICKER_APP_ID=your_project_number
```

The access token itself is minted server-side from the Google account you already
connected on the settings page. No extra consent popup is required. If either env var
is missing, `GET /api/drive/token` returns 400 and the picker button surfaces that
message.
