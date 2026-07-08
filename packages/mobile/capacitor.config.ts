import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.spark.bento",
  appName: "Bento",
  webDir: "www",
  server: {
    // Set to the real tunnel hostname from docs/setup/server.md before building.
    url: "https://bento.example.com",
    // Without errorPath the offline page is bundled but unreachable (Nexus lesson).
    errorPath: "error.html",
  },
};

export default config;
