import { accessSync, constants, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { connectOrStartCore, resolveCoreExecutable } from "./core-launcher";

const CORE_BINARY = path.resolve("target/debug/nodex-core");

const waitUntil = async (
  predicate: () => boolean,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};

describe("native Core launcher", () => {
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

  test("starts one detached Core and reuses the validated runtime", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    accessSync(CORE_BINARY, constants.X_OK);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-launcher-"));
    const input = {
      buildId: "core-launcher-integration-test",
      environment: { NODEX_CORE_EXECUTABLE: CORE_BINARY },
      isPackaged: false,
      nodexHome,
    } as const;
    let first: Awaited<ReturnType<typeof connectOrStartCore>> | null = null;

    try {
      first = await connectOrStartCore(input);
      expect(first.startedProcessId).not.toBeNull();
      expect(first.client.handshake.pid).toBe(first.startedProcessId);
      await expect(first.client.health()).resolves.toMatchObject({ status: "ready" });

      const reused = await connectOrStartCore(input);
      expect(reused.startedProcessId).toBeNull();
      expect(reused.client.handshake.pid).toBe(first.client.handshake.pid);

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
      })).rejects.toThrow(/Native Rust Core exited during startup with code \d+: .*--home/s);
    } finally {
      rmSync(nodexHome, { recursive: true, force: true });
    }
  });
});
