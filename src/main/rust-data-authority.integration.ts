import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { initializeDesktopDataAuthority } from "./core-client/desktop-data-authority";
import type { RustDataAuthorityRuntime } from "./core-client/desktop-data-authority";
import { closeDatabase, getDb } from "./local-store/database";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const temporaryDirectories: string[] = [];

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

const listCurrentProcessFiles = (): string => {
  if (process.platform !== "darwin") return "";
  return execFileSync(
    "/usr/sbin/lsof",
    ["-a", "-p", String(process.pid), "-Fn"],
    { encoding: "utf8" },
  );
};

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_CORE_BACKEND;
  delete process.env.NODEX_CORE_EXECUTABLE;
  delete process.env.NODEX_HOME;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Electron native data authority", () => {
  test("starts Core without opening the Profile database in Electron", async () => {
    expect(process.versions.electron).toBeTruthy();
    expect(existsSync(CORE_BINARY), "build nodex-core before this test").toBe(true);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-rust-authority-"));
    temporaryDirectories.push(nodexHome);
    process.env.NODEX_CORE_BACKEND = "rust";
    process.env.NODEX_CORE_EXECUTABLE = CORE_BINARY;
    process.env.NODEX_HOME = nodexHome;
    let runtime: RustDataAuthorityRuntime | null = null;

    try {
      const selected = await initializeDesktopDataAuthority({
        buildId: "electron-authority-integration-test",
        isPackaged: false,
        nodexHome,
      });
      expect(selected.backend).toBe("rust");
      if (selected.backend !== "rust") throw new Error("Expected Rust authority");
      runtime = selected;

      const databasePath = path.join(nodexHome, "nodex.db");
      expect(existsSync(databasePath)).toBe(true);
      expect(() => getDb()).toThrow(
        "native Rust Core owns this Profile",
      );
      expect(listCurrentProcessFiles()).not.toContain(databasePath);

      const startup = await runtime.rootClient.workspaceRead({ kind: "startup" });
      if (startup.value.kind !== "startup") {
        throw new Error("Core did not return the Workspace startup snapshot");
      }
      const projectId = startup.value.projects[0]?.id;
      if (!projectId) throw new Error("Core startup has no Project");
      await expect(
        runtime.clientForProject(projectId).databaseRead({
          target: { kind: "project_default" },
          mode: "catalog",
        }),
      ).resolves.toMatchObject({ value: { kind: "catalog" } });
    } finally {
      if (runtime) {
        await runtime.rootClient.shutdown().catch(() => undefined);
        const socketPath = path.join(nodexHome, "run/core/core.sock");
        await waitUntil(
          () => !existsSync(socketPath),
          "Core runtime socket remained after authority test shutdown",
        );
      }
    }
  });
});
