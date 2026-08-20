import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const vitestEntry = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const args = process.argv.slice(2);
const commandIndex = args.indexOf("--command");
const command = commandIndex < 0 ? "run" : args[commandIndex + 1];
if (command !== "run" && command !== "related") {
  throw new Error(`Unsupported Vitest command: ${JSON.stringify(command)}.`);
}
if (commandIndex >= 0) args.splice(commandIndex, 2);
const result = spawnSync(
  electronExecutable,
  [vitestEntry, command, ...args],
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
