import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readGhCliStatus,
  readGhPrStatus,
} from "./github-pr-service";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.PATH = originalPath;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("github PR service", () => {
  test("returns a typed disabled state when GitHub PR review is unavailable", async () => {
    const cwd = createTempDir("nodex-gh-pr-missing-");
    process.env.PATH = "";

    const status = await readGhCliStatus({ cwd });
    const prStatus = await readGhPrStatus({ cwd });

    expect(status.available).toBeFalse();
    expect(["missing-gh", "missing-remote", "not-authenticated"].includes(status.status)).toBeTrue();
    expect(prStatus.available).toBeFalse();
    expect(prStatus.status).toBe("disabled");
    expect(prStatus.disabledReason).toBe(status.status);
  });
});
