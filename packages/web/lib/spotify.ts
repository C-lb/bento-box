// Spotify's audio is DRM-locked and cannot be downloaded. We only read a track's
// public metadata (title + artist) via the Client Credentials flow, then hand the
// query to yt-dlp to fetch the matching song from YouTube. This flow has no user
// login and no refresh token; the access token is minted fresh (~1h) as needed.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export function spotifyConfigured(): boolean {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

// Matches open.spotify.com/track/<id> and the localized intl-xx/track/<id> form.
const TRACK_RE = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([a-zA-Z0-9]+)/i;
export function spotifyTrackId(url: string): string | null {
  const m = url.match(TRACK_RE);
  return m ? m[1] : null;
}
export function isSpotifyTrackUrl(url: string): boolean {
  return spotifyTrackId(url) !== null;
}

let cached: { token: string; exp: number } | null = null;
export async function getSpotifyToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 5_000) return cached.token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Spotify is not configured");
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(res.status === 400 || res.status === 401 ? "Spotify credentials were rejected" : `Spotify auth failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export interface SpotifyTrack {
  title: string;
  artist: string;
  query: string;
}
export async function resolveSpotifyTrack(url: string): Promise<SpotifyTrack> {
  const trackId = spotifyTrackId(url);
  if (!trackId) throw new Error("That is not a Spotify track link");
  const token = await getSpotifyToken();
  const res = await fetch(`${API}/tracks/${trackId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not read the Spotify track (${res.status})`);
  const data = (await res.json()) as { name: string; artists: { name: string }[] };
  const title = data.name;
  const artist = (data.artists ?? []).map((a) => a.name).join(", ");
  return { title, artist, query: `${artist} ${title}`.trim() };
}

// Health probe for the settings status chip: does auth succeed with the current
// credentials? Returns rather than throws so the UI can render red vs green.
export async function checkSpotify(): Promise<{ connected: boolean; error?: string }> {
  if (!spotifyConfigured()) return { connected: false, error: "No credentials set" };
  try {
    await getSpotifyToken();
    return { connected: true };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e) };
  }
}
