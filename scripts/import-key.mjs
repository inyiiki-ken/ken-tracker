// Usage: put the downloaded Google service-account JSON in the project folder,
// rename it to key.json, then run:  node scripts/import-key.mjs
// It writes GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY into .env.local
// (creating it from .env.example if needed) and then deletes key.json.
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";

const keyFile = process.argv[2] || "key.json";
if (!existsSync(keyFile)) {
  console.error(`✗ ${keyFile} not found. Put the downloaded JSON in this folder and rename it to key.json`);
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyFile, "utf8"));
if (!key.private_key || !key.client_email) {
  console.error("✗ That file doesn't look like a service-account key (no private_key / client_email).");
  process.exit(1);
}
if (!existsSync(".env.local")) copyFileSync(".env.example", ".env.local");

let env = readFileSync(".env.local", "utf8");
const set = (name, value) => {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, () => line) : env.trimEnd() + "\n" + line + "\n";
};
set("GOOGLE_SERVICE_ACCOUNT_EMAIL", key.client_email);
set("GOOGLE_PRIVATE_KEY", JSON.stringify(key.private_key)); // quoted, with \n escapes
writeFileSync(".env.local", env);
unlinkSync(keyFile);
console.log(`✓ .env.local updated for ${key.client_email}`);
console.log(`✓ ${keyFile} deleted (keep no copies of it lying around)`);
