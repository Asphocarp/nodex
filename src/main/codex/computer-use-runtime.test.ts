import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { BROWSER_RUNTIME_BUNDLE_DIRECTORY } from "../../shared/browser-runtime-metadata";
import { resolveBrowserRuntimeBundle } from "./browser-runtime-bundle";
import { writeBrowserRuntimeFixture } from "./browser-runtime-test-fixture";
import {
  ComputerUseAppMaterializer,
  ComputerUseRuntimeCoordinator,
  ComputerUseServiceManager,
} from "./computer-use-runtime";

const temporaryRoots: string[] = [];

function makeTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-computer-use-"));
  temporaryRoots.push(root);
  return root;
}

function makeRuntime() {
  const root = makeTemporaryRoot();
  const runtimeRoot = path.join(root, "runtime");
  writeBrowserRuntimeFixture(path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY));
  const browserRuntime = resolveBrowserRuntimeBundle({
    expectedCodexCompatibilityVersion: "0.144.6",
    runtimeRoot,
    targetArch: "arm64",
    targetPlatform: "darwin",
  });
  if (browserRuntime.status !== "available") throw new Error(browserRuntime.message);
  return { browserRuntime, root };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("ComputerUseAppMaterializer", () => {
  test("refreshes the canonical helper atomically and reuses a verified build", async () => {
    const root = makeTemporaryRoot();
    const sourceAppPath = path.join(root, "source", "Codex Computer Use.app");
    const sourceExecutable = path.join(sourceAppPath, "Contents", "MacOS", "SkyComputerUseService");
    fs.mkdirSync(path.dirname(sourceExecutable), { recursive: true });
    fs.writeFileSync(sourceExecutable, "signed-helper");
    fs.chmodSync(sourceExecutable, 0o755);
    const copyApp = vi.fn(async (source: string, target: string) => {
      await fs.promises.cp(source, target, { recursive: true });
    });
    const verifyApp = vi.fn(async (input: { serviceExecutablePath: string }) => {
      expect(fs.readFileSync(input.serviceExecutablePath, "utf8")).toBe("signed-helper");
    });
    const materializer = new ComputerUseAppMaterializer({
      bundleIdentifier: "com.openai.sky.CUAService",
      copyApp,
      desktopBuild: "test-build",
      runtimeStateHome: path.join(root, "state"),
      signingTeamId: "TESTTEAM",
      sourceAppPath,
      verifyApp,
    });

    const first = await materializer.materialize();
    const second = await materializer.materialize();

    expect(second).toEqual(first);
    expect(copyApp).toHaveBeenCalledTimes(1);
    expect(verifyApp).toHaveBeenCalledTimes(3);
    expect(first.appPath).toBe(path.join(root, "state", "computer-use", "Codex Computer Use.app"));
  });

  test("restores the prior canonical helper when post-swap verification fails", async () => {
    const root = makeTemporaryRoot();
    const sourceAppPath = path.join(root, "source", "Codex Computer Use.app");
    const sourceExecutable = path.join(sourceAppPath, "Contents", "MacOS", "SkyComputerUseService");
    fs.mkdirSync(path.dirname(sourceExecutable), { recursive: true });
    fs.writeFileSync(sourceExecutable, "old-helper");
    fs.chmodSync(sourceExecutable, 0o755);
    const runtimeStateHome = path.join(root, "state");
    const baseOptions = {
      bundleIdentifier: "com.openai.sky.CUAService",
      copyApp: async (source: string, target: string) => {
        await fs.promises.cp(source, target, { recursive: true });
      },
      runtimeStateHome,
      signingTeamId: "TESTTEAM",
      sourceAppPath,
    };
    const first = new ComputerUseAppMaterializer({
      ...baseOptions,
      desktopBuild: "build-1",
      verifyApp: async () => undefined,
    });
    const canonical = await first.materialize();
    fs.writeFileSync(sourceExecutable, "new-helper");

    const upgrade = new ComputerUseAppMaterializer({
      ...baseOptions,
      desktopBuild: "build-2",
      verifyApp: async ({ appPath, serviceExecutablePath }) => {
        if (
          !path.basename(appPath).startsWith(".staging-") &&
          fs.readFileSync(serviceExecutablePath, "utf8") === "new-helper"
        ) {
          throw new Error("post-swap validation failed");
        }
      },
    });

    await expect(upgrade.materialize()).rejects.toThrow("post-swap validation failed");
    expect(fs.readFileSync(canonical.serviceExecutablePath, "utf8")).toBe("old-helper");
  });
});

describe("ComputerUseServiceManager", () => {
  test("serializes native spawning, validates ownership, and releases without killing the shared service", async () => {
    const spawnComputerUseService = vi.fn(async () => 4217);
    const matches = vi.fn(() => true);
    const manager = new ComputerUseServiceManager({
      addon: {
        computerUseServiceProcessMatchesExecutablePath: matches,
        spawnComputerUseService,
      },
      isProcessAlive: () => true,
      serviceExecutablePath: "/tmp/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
    });

    await expect(Promise.all([manager.ensureRunning(), manager.ensureRunning()])).resolves.toEqual([
      { pid: 4217 },
      { pid: 4217 },
    ]);
    expect(spawnComputerUseService).toHaveBeenCalledTimes(1);

    manager.dispose();
    await expect(manager.ensureRunning()).resolves.toEqual({ pid: 4217 });
    expect(spawnComputerUseService).toHaveBeenCalledTimes(2);
  });

  test("respawns after the managed process exits and discards a PID-path mismatch", async () => {
    const livePids = new Set([5001, 5002]);
    const spawnedPids = [5001, 5002];
    let matchesExecutable = true;
    const manager = new ComputerUseServiceManager({
      addon: {
        computerUseServiceProcessMatchesExecutablePath: () => matchesExecutable,
        spawnComputerUseService: async () => spawnedPids.shift() ?? null,
      },
      isProcessAlive: (pid) => livePids.has(pid),
      serviceExecutablePath: "/tmp/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
    });

    await expect(manager.ensureRunning()).resolves.toEqual({ pid: 5001 });
    livePids.delete(5001);
    await expect(manager.ensureRunning()).resolves.toEqual({ pid: 5002 });

    matchesExecutable = false;
    manager.dispose();
  });

  test("can terminate an exact managed helper for an isolated conformance probe", async () => {
    const terminateProcess = vi.fn();
    const manager = new ComputerUseServiceManager({
      addon: {
        computerUseServiceProcessMatchesExecutablePath: () => true,
        spawnComputerUseService: async () => 6123,
      },
      isProcessAlive: () => true,
      serviceExecutablePath: "/tmp/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
      terminateManagedProcessOnDispose: true,
      terminateProcess,
    });

    await manager.ensureRunning();
    manager.dispose();

    expect(terminateProcess).toHaveBeenCalledExactlyOnceWith(6123);
  });
});

describe("ComputerUseRuntimeCoordinator", () => {
  test("gates startup and serves only ensureService for computer-use", async () => {
    const fixture = makeRuntime();
    const ensureRunning = vi.fn(async () => ({ pid: 8123 }));
    const disposeService = vi.fn();
    const captured: {
      requestHandler?: (method: string, params: unknown) => Promise<unknown>;
    } = {};
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const writeRuntimeConfig = vi.fn(async () => "/tmp/config.json");
    const coordinator = new ComputerUseRuntimeCoordinator({
      appMaterializer: {
        materialize: async () => ({
          appPath: "/tmp/Codex Computer Use.app",
          serviceExecutablePath: "/tmp/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
        }),
      },
      browserRuntime: fixture.browserRuntime,
      createNativePipeServer: (handler) => {
        captured.requestHandler = handler;
        return { close, pipePath: "/tmp/host-services.sock", start };
      },
      loadAddon: () => ({
        computerUseServiceProcessMatchesExecutablePath: () => true,
        spawnComputerUseService: async () => 8123,
      }),
      macOSRelease: "15.0",
      peerAuthorizationMode: "disabled",
      platform: "darwin",
      runtimeStateHome: path.join(fixture.root, "state"),
      serviceManager: {
        dispose: disposeService,
        ensureRunning,
      },
      writeRuntimeConfig,
    });

    await expect(coordinator.ensureReady()).resolves.toEqual({
      appPath: "/tmp/Codex Computer Use.app",
      hostServicesPipePath: "/tmp/host-services.sock",
      serviceExecutablePath: "/tmp/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
      status: "available",
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(writeRuntimeConfig).toHaveBeenCalledExactlyOnceWith({
      runtimeStateHome: path.join(fixture.root, "state"),
    });
    if (!captured.requestHandler) throw new Error("Missing request handler");
    await expect(
      captured.requestHandler("ensureService", {
        service: "computer-use",
      }),
    ).resolves.toEqual({});
    await expect(
      captured.requestHandler("ensureService", {
        service: "browser",
      }),
    ).rejects.toThrow("Unsupported host service");

    await coordinator.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    expect(disposeService).toHaveBeenCalledTimes(1);
    await expect(coordinator.ensureReady()).rejects.toThrow("closed");
  });
});
