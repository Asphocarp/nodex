import { accessSync, constants, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  connectOrStartCore,
  parseCoreStartupEventFrame,
  resolveCoreExecutable,
  resolveLegacyMigratorEnvironment,
} from "./core-launcher";

const CORE_BINARY = path.resolve("target/debug/nodex-core");

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};

describe("native Core launcher", () => {
  test("parses only bounded versioned startup frames", () => {
    expect(parseCoreStartupEventFrame({
      startup_event_version: 1,
      event: { kind: "migration_started", from_version: 86, to_version: 88 },
    })).toEqual({ kind: "migration_started", fromVersion: 86, toVersion: 88 });
    expect(parseCoreStartupEventFrame({ selection_version: 1 })).toBeNull();
    expect(() => parseCoreStartupEventFrame({
      startup_event_version: 2,
      event: { kind: "migration_started", from_version: 86, to_version: 88 },
    })).toThrow("version is unsupported");
    expect(() => parseCoreStartupEventFrame({
      startup_event_version: 1,
      event: { kind: "invented" },
    })).toThrow("kind is unsupported");
  });

  test("resolves explicit, packaged, and development executables", () => {
    expect(
      resolveCoreExecutable({
        environment: { NODEX_CORE_EXECUTABLE: "/opt/nodex/bin/nodex-core" },
        isPackaged: false,
      }),
    ).toBe("/opt/nodex/bin/nodex-core");
    expect(
      resolveCoreExecutable({
        appResourcesPath: "/Applications/Nodex.app/Contents/Resources",
        isPackaged: true,
      }),
    ).toBe("/Applications/Nodex.app/Contents/Resources/bin/nodex-core");
    expect(
      resolveCoreExecutable({
        isPackaged: false,
        repositoryRoot: "/work/nodex",
      }),
    ).toBe("/work/nodex/target/debug/nodex-core");
    expect(() =>
      resolveCoreExecutable({
        environment: { NODEX_CORE_EXECUTABLE: "target/debug/nodex-core" },
        isPackaged: false,
      }),
    ).toThrow("NODEX_CORE_EXECUTABLE must be absolute");
  });

  test("resolves the frozen legacy migrator for development startup", () => {
    const environment = resolveLegacyMigratorEnvironment({
      isPackaged: false,
      repositoryRoot: path.resolve("."),
    });
    expect(environment).toEqual({
      NODEX_LEGACY_MIGRATOR_EXECUTABLE: process.execPath,
      NODEX_LEGACY_MIGRATOR_SCRIPT: path.resolve(
        "resources/legacy-profile-migrator.mjs",
      ),
      NODEX_LEGACY_MIGRATOR_SHA256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  test("leaves packaged migrator discovery to the closed Core runtime", () => {
    expect(resolveLegacyMigratorEnvironment({
      appResourcesPath: "/Applications/Nodex.app/Contents/Resources",
      isPackaged: true,
    })).toEqual({});
  });

  test("rejects partial or malformed legacy migrator overrides", () => {
    expect(() =>
      resolveLegacyMigratorEnvironment({
        isPackaged: false,
        environment: { NODEX_LEGACY_MIGRATOR_SCRIPT: "/opt/nodex/migrator.mjs" },
      }),
    ).toThrow("overrides must be configured together");
    expect(() =>
      resolveLegacyMigratorEnvironment({
        isPackaged: false,
        environment: {
          NODEX_LEGACY_MIGRATOR_EXECUTABLE: "/opt/nodex/node",
          NODEX_LEGACY_MIGRATOR_SCRIPT: "/opt/nodex/migrator.mjs",
          NODEX_LEGACY_MIGRATOR_SHA256: "not-a-digest",
        },
      }),
    ).toThrow("invalid bundle digest");
  });

  test("starts one detached Core and reuses the validated runtime", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    accessSync(CORE_BINARY, constants.X_OK);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-launcher-"));
    const input = {
      buildId: "core-launcher-integration-test",
      connectionId: "desktop-host:core-launcher-integration-test",
      environment: { NODEX_CORE_EXECUTABLE: CORE_BINARY },
      isPackaged: false,
      nodexHome,
    } as const;
    let first: Awaited<ReturnType<typeof connectOrStartCore>> | null = null;
    const startupEvents: string[] = [];

    try {
      first = await connectOrStartCore({
        ...input,
        onStartupEvent: (event) => startupEvents.push(event.kind),
      });
      expect(first.startedProcessId).not.toBeNull();
      expect(startupEvents).toEqual(["candidate_checked", "store_ready"]);
      expect(first.timings.disposition).toBe("started");
      expect(first.client.handshake.generation.pid).toBe(first.startedProcessId);
      await expect(first.client.health()).resolves.toMatchObject({ status: "ready" });

      const reusedEvents: string[] = [];
      const reused = await connectOrStartCore({
        ...input,
        onStartupEvent: (event) => reusedEvents.push(event.kind),
      });
      expect(reused.startedProcessId).toBeNull();
      expect(reusedEvents).toEqual(["candidate_checked"]);
      expect(reused.timings.disposition).toBe("reused");
      expect(reused.client.handshake.generation.pid).toBe(first.client.handshake.generation.pid);
      await waitUntil(
        async () => (await reused.client.health()).metrics.active_clients === 1,
        "Core retained the short-lived selector probe after runtime reuse",
      );

      await first.client.shutdown();
      const socketPath = path.join(nodexHome, "run/core/core.sock");
      await waitUntil(
        () => !existsSync(socketPath),
        "Core runtime socket remained after shutdown",
      );
    } finally {
      if (first && existsSync(path.join(nodexHome, "run/core/core.sock"))) {
        await first.client.shutdown().catch(() => undefined);
      }
      rmSync(nodexHome, { recursive: true, force: true });
    }
  });

  test("includes Core stderr when startup exits", async () => {
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-launcher-failure-"));

    try {
      await expect(connectOrStartCore({
        buildId: "core-launcher-failure-test",
        environment: { NODEX_CORE_EXECUTABLE: process.execPath },
        isPackaged: false,
        nodexHome,
        startupTimeoutMs: 2_000,
      })).rejects.toThrow(/Native Rust Core exited before selection with code \d+: .*--home/s);
    } finally {
      rmSync(nodexHome, { recursive: true, force: true });
    }
  });
});
