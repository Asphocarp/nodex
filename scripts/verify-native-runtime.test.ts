import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  assertContentAddressedStoreMigrationBackup,
  assertLegacyPackagedRuntimePathsAbsent,
  removePrivateTemporaryDirectory,
  selectPackagedSmokeProjectId,
  shutdownPackagedCore,
} from "./verify-native-runtime";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!fs.existsSync(directory)) continue;
    fs.chmodSync(directory, 0o700);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("packaged native runtime verification", () => {
  test("verifies the migration backup digest encoded in its filename", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-migration-backup-"));
    temporaryDirectories.push(directory);
    const bytes = Buffer.from("content-addressed Store backup");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const backupPath = path.join(directory, `v130-to-v131-${digest}.db`);
    fs.writeFileSync(backupPath, bytes);

    expect(() => assertContentAddressedStoreMigrationBackup(backupPath)).not.toThrow();
    fs.appendFileSync(backupPath, "tampered");
    expect(() => assertContentAddressedStoreMigrationBackup(backupPath)).toThrow(
      "digest does not match its filename",
    );
  });

  test("uses the one Project returned by fresh-Profile bootstrap", () => {
    expect(selectPackagedSmokeProjectId([{ id: "019c-generated-project" }])).toBe(
      "019c-generated-project",
    );
    expect(() => selectPackagedSmokeProjectId([])).toThrow(
      "expected one bootstrapped Project, found 0",
    );
    expect(() =>
      selectPackagedSmokeProjectId([{ id: "project-one" }, { id: "project-two" }]),
    ).toThrow("expected one bootstrapped Project, found 2");
  });

  test("explicitly drains the Core held by the bootstrap client", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-native-runtime-shutdown-"));
    temporaryDirectories.push(directory);
    const descriptor = path.join(directory, "core.json");
    fs.writeFileSync(descriptor, "{}\n");
    let shutdownCalls = 0;

    await expect(
      shutdownPackagedCore(
        {
          shutdown: async () => {
            shutdownCalls += 1;
            fs.rmSync(descriptor);
            return { status: "draining" };
          },
        },
        descriptor,
      ),
    ).resolves.toBeUndefined();

    expect(shutdownCalls).toBe(1);
    await expect(
      shutdownPackagedCore(
        {
          shutdown: async () => ({ status: "busy" }),
        },
        descriptor,
      ),
    ).rejects.toThrow("rejected smoke-test shutdown with busy");
  });

  test("rejects the obsolete nested Agent runtime even when canonical resources exist", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-native-runtime-layout-"));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, "Resources", "agent-runtime"), { recursive: true });

    expect(() => assertLegacyPackagedRuntimePathsAbsent(directory)).toThrow(
      "obsolete duplicate path",
    );
  });

  test("removes Core search caches with read-only directories", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-native-runtime-cleanup-"));
    temporaryDirectories.push(directory);
    const cacheDirectory = path.join(
      directory,
      "profile/search-snapshots/.reusable/pages/page-hash",
    );
    fs.mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(cacheDirectory, "body.nested.md"), "body\n", {
      mode: 0o400,
    });
    fs.chmodSync(cacheDirectory, 0o500);
    fs.chmodSync(path.dirname(cacheDirectory), 0o500);

    removePrivateTemporaryDirectory(directory);

    expect(fs.existsSync(directory)).toBe(false);
  });
});
