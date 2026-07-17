import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.wahspark.bento",
  appName: "Bento Box",
  webDir: "www",
  server: {
    // Tailscale Funnel to this Mac's standalone server on :3100 (passcode-gated).
    // Stable hostname — survives reboots/restarts (tailscaled via brew services + funnel --bg).
    // LAN fallback: http://10.130.3.135:3100 (needs cleartext: true, kept below).
    url: "https://calebs-macbook-pro.tailba0755.ts.net",
    cleartext: true,
    // Without errorPath the offline page is bundled but unreachable (Nexus lesson).
    errorPath: "error.html",
  },
};

export default config;
