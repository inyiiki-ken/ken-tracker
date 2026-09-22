// After `next build`, Next's standalone output (.next/standalone) does NOT
// include the static assets or the public/ folder. Copy them in so the packaged
// desktop server can serve CSS/JS/images. Run automatically by `npm run dist`.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("✗ .next/standalone not found. Run `next build` first (output: 'standalone').");
  process.exit(1);
}

// .next/static -> .next/standalone/.next/static
const staticSrc = join(root, ".next", "static");
const staticDest = join(standalone, ".next", "static");
if (existsSync(staticSrc)) {
  mkdirSync(join(standalone, ".next"), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log("✓ copied .next/static");
}

// public -> .next/standalone/public
const publicSrc = join(root, "public");
const publicDest = join(standalone, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true });
  console.log("✓ copied public/");
}

console.log("✓ standalone prepared for packaging");
