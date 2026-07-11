import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const vitestEntry = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(
  electronExecutable,
  [vitestEntry, "run", ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "test",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
