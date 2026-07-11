import fs from "node:fs";
import path from "node:path";

const prebuildsDir = path.resolve("node_modules/node-pty/prebuilds");

if (!fs.existsSync(prebuildsDir)) process.exit(0);

for (const platformDir of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
  if (!platformDir.isDirectory()) continue;
  const helperPath = path.join(prebuildsDir, platformDir.name, "spawn-helper");
  if (!fs.existsSync(helperPath)) continue;
  fs.chmodSync(helperPath, 0o755);
}
