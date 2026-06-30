# Canva Renderer Setup

The Headshot Studio Canva renderer requires manual out-of-band setup in the Canva developer portal.

## Prerequisites

- Canva **Teams or Enterprise** plan. Free and Pro plans cannot use the autofill and export APIs (they return 403 Forbidden).

## Step 1: Create a Connect Integration

1. Go to [Canva Developer Portal](https://www.canva.com/developers).
2. Create a new **Connect** integration (not Design or Apps).
3. Set the redirect URI to exactly `http://127.0.0.1:3000/api/canva/callback` (note: Canva rejects `localhost` - use the IP address).
4. Enable these scopes:
   - `brandtemplate:meta:read`
   - `brandtemplate:content:read`
   - `asset:write`
   - `design:content:write`
   - `design:meta:read`
   - `design:content:read`
5. Save and copy the **Client ID** and **Client Secret**.

## Step 2: Create a Brand Template

1. In Canva, create a new blank design at the size you want (e.g., 400x500px for a headshot card).
2. Add placeholders for:
   - **photo** (image field) - where the headshot will be inserted
   - **name** (text field) - the person's name
   - **title** (text field) - the person's job title
3. Style the template as desired (background, fonts, layout).
4. Save as a **Brand Template** and note its ID.

## Step 3: Add Credentials to `.env`

In the repo-root `.env` file (not `.env.example`), add:

```
CANVA_CLIENT_ID=<your_client_id>
CANVA_CLIENT_SECRET=<your_client_secret>
```

Replace `<your_client_id>` and `<your_client_secret>` with the credentials from Step 1.

## Step 4: Connect via the App

1. Start the dev server: `npm run dev` (from the repo root).
2. Open http://127.0.0.1:3000/settings in your browser (not `localhost`).
3. Scroll to **Canva** and click **Connect**.
4. Approve the OAuth flow.

## Step 5: Use the Renderer

1. Open http://127.0.0.1:3000/studio.
2. In the renderer dropdown, select **Canva**.
3. A template picker will appear. Select the brand template you created in Step 2.
4. Upload or select a photo, enter the name and title, and click **Generate**.
5. The app will autofill the template and export a PNG headshot.

## Important Notes

- **Dev server address:** The app must be reachable at `127.0.0.1:3000`, not `localhost`. Canva's OAuth callback matches the exact redirect URI - if the server is behind a different hostname, the callback will fail.
- **Export only:** Only Teams and Enterprise plans can export designs to PNG. Attempting export on a lower plan results in a 403 error.
- **Template naming:** The data fields in your brand template must be named exactly `photo`, `name`, and `title` (case-sensitive, lowercase). The app looks for these by name when autofilling.
