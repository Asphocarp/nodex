import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

test("the public nodex bin delegates arguments to the native CLI", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-native-cli-launcher-"));
  try {
    const executable = path.join(directory, "nodex-native-fixture");
    fs.writeFileSync(executable, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o755 });

    const output = execFileSync(
      process.execPath,
      [path.resolve("bin/nodex.mjs"), "read", "page with spaces"],
      {
        encoding: "utf8",
        env: { ...process.env, NODEX_NATIVE_CLI: executable },
      },
    );

    expect(output).toBe("read\npage with spaces\n");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
