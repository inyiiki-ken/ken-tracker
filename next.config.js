/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained server bundle (.next/standalone) so the desktop
  // (Electron) build can run the app locally without the full node_modules.
  output: "standalone",
};
module.exports = nextConfig;
