import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);

test("runs the schema CLI entrypoint through tsx", () => {
  const result = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), resolve(scriptDir, "codex-schemas.ts"), "invalid"],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain('Expected "generate" or "verify".');
});
