// electron-builder "beforePack" hook: refuse to package/publish an installer
// that doesn't contain the app server. (A leftover dev build once produced an
// empty installer that auto-updated onto PCs and couldn't start.)
const { existsSync } = require("node:fs");
const { join } = require("node:path");

exports.default = async function verifyStandalone(context) {
  const root = context.packager.projectDir;
  const server = join(root, ".next", "standalone", "server.js");
  const staticDir = join(root, ".next", "standalone", ".next", "static");
  if (!existsSync(server) || !existsSync(staticDir)) {
    throw new Error(
      "STOP: the app build is missing (.next/standalone). Nothing was published.\n" +
      "Run the full release instead:  npm run release:win   (or release.bat)"
    );
  }
};
