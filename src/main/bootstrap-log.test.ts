import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { writeBootstrapLog } from "./bootstrap-log";

describe("bootstrap logging", () => {
  test("persists info while restricting terminal output to warnings and errors", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-bootstrap-log-test-"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const options = {
        consoleEnabled: true,
        fileEnabled: true,
        consoleLevel: "warn" as const,
        fileLevel: "info" as const,
      };
      writeBootstrapLog(root, "info", "durable bootstrap info", {}, options);
      writeBootstrapLog(root, "warn", "visible bootstrap warning", {}, options);

      expect(info).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);

      const logDir = path.join(root, "logs");
      const records = fs.readdirSync(logDir).flatMap((fileName) =>
        fs
          .readFileSync(path.join(logDir, fileName), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { level: string; msg: string }),
      );
      expect(records.map((record) => [record.level, record.msg])).toEqual([
        ["info", "durable bootstrap info"],
        ["warn", "visible bootstrap warning"],
      ]);
    } finally {
      info.mockRestore();
      warn.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
