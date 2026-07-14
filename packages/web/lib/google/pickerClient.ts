"use client";

// Client-side helpers for Google's native Picker. The Picker is Google-hosted,
// so it browses everything the signed-in account can see — My Drive, Shared
// with me, and shared drives — with search built in. That's why we prefer it
// over listing folders through our own API, which trips over shared-drive
// access.

/** Load the gapi Picker module once, reusing the tag across callers. */
export function loadGooglePicker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.google?.picker) return resolve();
    const onload = () => w.gapi.load("picker", { callback: () => resolve() });
    const existing = document.getElementById("gapi-js") as HTMLScriptElement | null;
    if (existing) { onload(); return; }
    const s = document.createElement("script");
    s.id = "gapi-js";
    s.src = "https://apis.google.com/js/api.js";
    s.onload = onload;
    s.onerror = () => reject(new Error("Failed to load the Google Picker"));
    document.body.appendChild(s);
  });
}

export type PickerToken = { access_token: string; apiKey?: string | null; appId?: string | null };

/** Fetch the short-lived OAuth token the Picker signs its requests with. */
export async function fetchPickerToken(): Promise<PickerToken> {
  const r = await fetch("/api/drive/token");
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? "Could not open the Drive picker");
  return data as PickerToken;
}
