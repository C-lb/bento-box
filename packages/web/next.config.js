/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk"],
};
export default nextConfig;
