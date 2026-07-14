export type Guide = { steps: string[] } | { note: string };

export const KEY_GUIDES: Record<string, Guide> = {
  "Claude (Anthropic)": { note: "Ask Caleb for help." },
  "Groq (transcription)": {
    steps: [
      "Go to console.groq.com and sign in.",
      "Open API Keys in the left menu.",
      "Click Create API Key and give it a name.",
      "Copy the key (it starts with gsk_) and paste it below. Groq shows it once.",
    ],
  },
  Google: {
    steps: [
      "Open console.cloud.google.com and create or pick a project.",
      "In APIs and Services, Library, enable the Google Drive API and the Google Sheets API.",
      "In APIs and Services, OAuth consent screen, set it up as External and add your own email as a test user.",
      "In APIs and Services, Credentials, choose Create credentials, OAuth client ID, Web application.",
      "Under Authorized redirect URIs add both http://localhost:3000/api/google/callback and http://localhost:3001/api/google/callback (the app uses 3001 if 3000 is taken).",
      "Copy the Client ID and Client secret into the fields below.",
    ],
  },
  Canva: {
    steps: [
      "Go to canva.com/developers and sign in.",
      "Create an integration under Your integrations, Create an integration.",
      "In Configuration, Add redirect URL, add http://127.0.0.1:3000/api/canva/callback. Use 127.0.0.1, not localhost, Canva rejects localhost.",
      "In Scopes, enable design content read and write and asset read.",
      "Copy the Client ID, generate a Client secret, and paste both below.",
    ],
  },
  Spotify: {
    steps: [
      "Go to developer.spotify.com/dashboard and log in with any Spotify account.",
      "Click Create app. Name it anything, and for Redirect URI put http://127.0.0.1:4571/callback (required but unused here).",
      "Under Which API/SDKs, tick Web API, then save.",
      "Open Settings, copy the Client ID, click View client secret, and paste both below.",
      "Only public track details are read (title and artist). No login, no audio access.",
    ],
  },
};
