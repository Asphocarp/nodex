import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const vitestEntry = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const args = process.argv.slice(2);
const commandIndex = args.findIndex(
  (argument) => argument === "--command" || argument.startsWith("--command="),
);
const commandOption = commandIndex < 0 ? undefined : args[commandIndex];
const inlineCommand = commandOption?.startsWith("--command=")
  ? commandOption.slice("--command=".length)
  : undefined;
const command = commandIndex < 0 ? "run" : (inlineCommand ?? args[commandIndex + 1]);
if (commandIndex >= 0 && (!command || command.startsWith("--"))) {
  throw new Error("--command requires a value.");
}
if (command !== "run" && command !== "related") {
  throw new Error(`Unsupported Vitest command: ${JSON.stringify(command)}.`);
}
if (commandIndex >= 0) args.splice(commandIndex, inlineCommand === undefined ? 2 : 1);
const result = spawnSync(electronExecutable, [vitestEntry, command, ...args], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "test",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
