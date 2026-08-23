import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  assertContentAddressedStoreMigrationBackup,
  assertLegacyPackagedRuntimePathsAbsent,
  isPackagedAppReady,
  removePrivateTemporaryDirectory,
  selectPackagedSmokeProjectId,
  shutdownPackagedCore,
} from "./verify-native-runtime";
import {
  acquireIsolatedRunLease,
  markIsolatedRunClaimReady,
  publishIsolatedRunClaim,
} from "../src/main/core-client/isolated-run-ownership";

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
    const backupPath = path.join(directory, `v130-to-v132-${digest}.db`);
    fs.writeFileSync(backupPath, bytes);

    const transition = { sourceRevision: 130, targetRevision: 132 };
    expect(() => assertContentAddressedStoreMigrationBackup(backupPath, transition)).not.toThrow();
    expect(() =>
      assertContentAddressedStoreMigrationBackup(backupPath, {
        sourceRevision: 130,
        targetRevision: 131,
      }),
    ).toThrow("transition does not match the runtime");
    fs.appendFileSync(backupPath, "tampered");
    expect(() => assertContentAddressedStoreMigrationBackup(backupPath, transition)).toThrow(
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

  test("requires one supervised host and Core generation to reach packaged app readiness", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-packaged-app-ready-"));
    temporaryDirectories.push(directory);
    const nodexHome = path.join(directory, "profile");
    fs.mkdirSync(nodexHome, { mode: 0o700 });
    const runId = randomUUID();
    const lease = acquireIsolatedRunLease({
      nodexHome,
      runId,
      supervisorPid: process.pid,
    });
    const descriptorPath = path.join(nodexHome, "run/core/core.json");
    const expectedCoreSha256 = "a".repeat(64);
    const readiness = () =>
      isPackagedAppReady({
        descriptorPath,
        expectedCoreSha256,
        expectedHostPid: process.pid,
        nodexHome,
        runId,
      });

    try {
      expect(readiness()).toBe(false);
      publishIsolatedRunClaim({ nodexHome, runId, hostPid: process.pid });
      expect(readiness()).toBe(false);
      fs.mkdirSync(path.dirname(descriptorPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        descriptorPath,
        `${JSON.stringify({
          artifact: { sha256: expectedCoreSha256 },
          manifest_digest: "b".repeat(64),
          pid: 42,
          start_nonce: "packaged-smoke-core",
        })}\n`,
      );
      markIsolatedRunClaimReady({ nodexHome, runId });

      expect(readiness()).toBe(true);
      expect(() =>
        isPackagedAppReady({
          descriptorPath,
          expectedCoreSha256,
          expectedHostPid: process.pid + 1,
          nodexHome,
          runId,
        }),
      ).toThrow("readiness belongs to another host generation");
    } finally {
      lease.release();
    }
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
