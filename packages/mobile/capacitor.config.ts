import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.spark.bento",
  appName: "Bento",
  webDir: "www",
  server: {
    // Dev: this Mac on the same Wi-Fi, serving `npm -w @event-editor/web run start`.
    // Swap to the real tunnel hostname from docs/setup/server.md once deployed.
    url: "http://10.130.3.135:3100",
    cleartext: true,
    // Without errorPath the offline page is bundled but unreachable (Nexus lesson).
    errorPath: "error.html",
  },
};

export default config;
