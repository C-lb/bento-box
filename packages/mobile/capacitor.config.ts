import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.wahspark.bento",
  appName: "Bento",
  webDir: "www",
  server: {
    // Cloudflare quick tunnel to this Mac's standalone server on :3100 (passcode-gated).
    // NOTE: trycloudflare.com URLs are ephemeral — a cloudflared restart mints a new one;
    // update this and re-sync, or swap to a named-tunnel hostname (docs/setup/server.md).
    // LAN fallback: http://10.130.3.135:3100 (needs cleartext: true, kept below).
    url: "https://copyright-addresses-guarantee-myth.trycloudflare.com",
    cleartext: true,
    // Without errorPath the offline page is bundled but unreachable (Nexus lesson).
    errorPath: "error.html",
  },
};

export default config;
