import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { components } from "@nodex/core-protocol";
import {
  acquireIsolatedRunLease,
  markIsolatedRunClaimReady,
  publishIsolatedRunClaim,
  readIsolatedRunLeaseOwner,
} from "../src/main/core-client/isolated-run-ownership";
import {
  cleanupIsolatedCore,
  parseIsolatedRunSupervisorArguments,
  superviseIsolatedRun,
  type IsolatedCoreCleanupDependencies,
  type SupervisorSignalSource,
} from "./isolated-run-supervisor";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const createdHomes: string[] = [];

const GENERATION: components["schemas"]["RuntimeGenerationIdentity"] = {
  artifact_sha256: "a".repeat(64),
  manifest_digest: "b".repeat(64),
  pid: 4242,
  profile_id: "profile:test",
  readiness_generation: 1,
  start_nonce: "c".repeat(32),
  store_epoch: "store:test",
};

const createNodexHome = (): string => {
  const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-supervisor-test-"));
  chmodSync(nodexHome, 0o700);
  createdHomes.push(nodexHome);
  return nodexHome;
};

const acquireLease = (nodexHome: string) =>
  acquireIsolatedRunLease({
    nodexHome,
    runId: RUN_A,
    supervisorPid: process.pid,
  });

const cleanupDependencies = (
  overrides: Partial<IsolatedCoreCleanupDependencies> = {},
): Partial<IsolatedCoreCleanupDependencies> => ({
  connectCore: vi.fn(async () => ({
    handshake: { generation: GENERATION },
    shutdown: vi.fn(async () => ({ status: "draining" as const })),
  })),
  delay: vi.fn(async () => undefined),
  inspectRuntimeEvidence: vi.fn(() => "none"),
  isPidAlive: vi.fn(() => false),
  now: vi.fn(() => 0),
  readRuntimeGeneration: vi.fn(() => GENERATION),
  ...overrides,
});

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  readonly pid = 4321;
  readonly kill = vi.fn(() => true);

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.emit("close", code, signal);
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const nodexHome of createdHomes.splice(0)) {
    rmSync(nodexHome, { force: true, recursive: true });
  }
});

describe("isolated run supervisor", () => {
  test("accepts only the package scripts selected by run.sh", () => {
    expect(parseIsolatedRunSupervisorArguments(["dev"])).toBe("dev");
    expect(parseIsolatedRunSupervisorArguments(["--", "dev"])).toBe("dev");
    expect(parseIsolatedRunSupervisorArguments(["build:run"])).toBe(
      "build:run",
    );
    expect(
      parseIsolatedRunSupervisorArguments(["build:run:prepared"]),
    ).toBe("build:run:prepared");
    expect(() => parseIsolatedRunSupervisorArguments([])).toThrow("Usage");
    expect(() =>
      parseIsolatedRunSupervisorArguments(["--", "dev", "extra"]),
    ).toThrow("Usage");
    expect(() =>
      parseIsolatedRunSupervisorArguments(["arbitrary"]),
    ).toThrow("Unsupported");
  });

  test("releases the lease when no Core runtime was started", async () => {
    const nodexHome = createNodexHome();
    const lease = acquireLease(nodexHome);

    await expect(
      cleanupIsolatedCore({
        lease,
        nodexHome,
        runId: RUN_A,
        dependencies: cleanupDependencies({
          readClaim: vi.fn(() => null),
        }),
      }),
    ).resolves.toEqual({
      status: "not_started",
      safeToDeleteRunRoot: true,
    });
    expect(readIsolatedRunLeaseOwner(nodexHome)).toBeNull();
  });

  test("retains an interrupted starting claim but releases a ready claim after Core disappears", async () => {
    const interruptedHome = createNodexHome();
    const interruptedLease = acquireLease(interruptedHome);
    publishIsolatedRunClaim({
      nodexHome: interruptedHome,
      runId: RUN_A,
      hostPid: process.pid,
    });

    await expect(
      cleanupIsolatedCore({
        lease: interruptedLease,
        nodexHome: interruptedHome,
        runId: RUN_A,
        dependencies: cleanupDependencies(),
      }),
    ).resolves.toMatchObject({
      status: "failed",
      safeToDeleteRunRoot: false,
      reason: "Primary Electron startup did not reach confirmed Core readiness",
    });
    expect(readIsolatedRunLeaseOwner(interruptedHome)?.runId).toBe(RUN_A);
    interruptedLease.release();

    const stoppedHome = createNodexHome();
    const stoppedLease = acquireLease(stoppedHome);
    publishIsolatedRunClaim({
      nodexHome: stoppedHome,
      runId: RUN_A,
      hostPid: process.pid,
    });
    markIsolatedRunClaimReady({
      nodexHome: stoppedHome,
      runId: RUN_A,
    });

    await expect(
      cleanupIsolatedCore({
        lease: stoppedLease,
        nodexHome: stoppedHome,
        runId: RUN_A,
        dependencies: cleanupDependencies(),
      }),
    ).resolves.toEqual({
      status: "not_started",
      safeToDeleteRunRoot: true,
    });
    expect(readIsolatedRunLeaseOwner(stoppedHome)).toBeNull();
  });

  test("authenticates and drains only after a matching primary-host claim", async () => {
    const nodexHome = createNodexHome();
    const lease = acquireLease(nodexHome);
    publishIsolatedRunClaim({
      nodexHome,
      runId: RUN_A,
      hostPid: process.pid,
    });
    const inspectRuntimeEvidence = vi.fn()
      .mockReturnValueOnce("complete")
      .mockReturnValueOnce("none");
    const shutdown = vi.fn(async () => ({ status: "draining" as const }));
    const connectCore = vi.fn(async () => ({
      handshake: { generation: GENERATION },
      shutdown,
    }));

    await expect(
      cleanupIsolatedCore({
        lease,
        nodexHome,
        runId: RUN_A,
        dependencies: cleanupDependencies({
          connectCore,
          inspectRuntimeEvidence,
          isPidAlive: vi.fn(() => false),
        }),
      }),
    ).resolves.toEqual({
      status: "stopped",
      safeToDeleteRunRoot: true,
    });
    expect(connectCore).toHaveBeenCalledWith({
      nodexHome,
      clientKind: "native_cli",
      buildId: "nodex-isolated-run-supervisor",
      requestTimeoutMs: 5_000,
    });
    expect(shutdown).toHaveBeenCalledOnce();
    expect(readIsolatedRunLeaseOwner(nodexHome)).toBeNull();
  });

  test("retains the lease when runtime evidence has no host claim", async () => {
    const nodexHome = createNodexHome();
    const lease = acquireLease(nodexHome);
    const connectCore = vi.fn();

    await expect(
      cleanupIsolatedCore({
        lease,
        nodexHome,
        runId: RUN_A,
        dependencies: cleanupDependencies({
          connectCore,
          inspectRuntimeEvidence: vi.fn(() => "partial"),
          readClaim: vi.fn(() => null),
        }),
      }),
    ).resolves.toMatchObject({
      status: "not_owner",
      safeToDeleteRunRoot: false,
    });
    expect(connectCore).not.toHaveBeenCalled();
    expect(readIsolatedRunLeaseOwner(nodexHome)?.runId).toBe(RUN_A);
    lease.release();
  });

  test("retains the lease when a replacement generation appears", async () => {
    const nodexHome = createNodexHome();
    const lease = acquireLease(nodexHome);
    publishIsolatedRunClaim({
      nodexHome,
      runId: RUN_A,
      hostPid: process.pid,
    });
    const replacement = { ...GENERATION, start_nonce: "d".repeat(32) };

    await expect(
      cleanupIsolatedCore({
        lease,
        nodexHome,
        runId: RUN_A,
        dependencies: cleanupDependencies({
          inspectRuntimeEvidence: vi.fn(() => "complete"),
          isPidAlive: vi.fn(() => true),
          readRuntimeGeneration: vi.fn(() => replacement),
        }),
      }),
    ).resolves.toMatchObject({
      status: "generation_changed",
      safeToDeleteRunRoot: false,
    });
    expect(readIsolatedRunLeaseOwner(nodexHome)?.runId).toBe(RUN_A);
    lease.release();
  });

  test("retains the lease when graceful shutdown times out", async () => {
    const nodexHome = createNodexHome();
    const lease = acquireLease(nodexHome);
    publishIsolatedRunClaim({
      nodexHome,
      runId: RUN_A,
      hostPid: process.pid,
    });
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10);

    await expect(
      cleanupIsolatedCore({
        lease,
        nodexHome,
        runId: RUN_A,
        shutdownTimeoutMs: 5,
        dependencies: cleanupDependencies({
          inspectRuntimeEvidence: vi.fn()
            .mockReturnValueOnce("complete")
            .mockReturnValueOnce("partial"),
          isPidAlive: vi.fn(() => true),
          now,
        }),
      }),
    ).resolves.toMatchObject({
      status: "failed",
      safeToDeleteRunRoot: false,
      reason: "Timed out waiting for isolated Core to exit",
    });
    expect(readIsolatedRunLeaseOwner(nodexHome)?.runId).toBe(RUN_A);
    lease.release();
  });

  test("acquires the lease before spawn and preserves the caller idle timeout", async () => {
    const nodexHome = createNodexHome();
    const child = new FakeChild();
    const signalSource = new EventEmitter() as unknown as SupervisorSignalSource;
    let observedOptions: SpawnOptions | undefined;
    const spawnChild = vi.fn((
      _command: string,
      _args: readonly string[],
      options: SpawnOptions,
    ) => {
      expect(readIsolatedRunLeaseOwner(nodexHome)?.runId).toBe(RUN_A);
      observedOptions = options;
      queueMicrotask(() => child.close(0));
      return child.asChildProcess();
    });

    await expect(
      superviseIsolatedRun({
        environment: {
          NODEX_CORE_IDLE_TIMEOUT_MS: "65432",
          NODEX_HOME: nodexHome,
        },
        nodexHome,
        repositoryRoot: path.resolve("."),
        runScript: "dev",
        dependencies: {
          cleanupDependencies: cleanupDependencies({
            readClaim: vi.fn(() => null),
          }),
          delay: vi.fn(async () => undefined),
          forceExit: vi.fn(),
          generateRunId: () => RUN_A,
          isProcessGroupAlive: vi.fn(() => false),
          now: vi.fn(() => 0),
          signalSource,
          signalProcessGroup: vi.fn(),
          spawnChild,
        },
      }),
    ).resolves.toEqual({
      childExitCode: 0,
      cleanupStatus: "not_started",
      safeToDeleteRunRoot: true,
    });
    expect(spawnChild).toHaveBeenCalledWith(
      "pnpm",
      ["--silent", "run", "dev"],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: "inherit",
      }),
    );
    expect(observedOptions?.env).toMatchObject({
      NODEX_CORE_IDLE_TIMEOUT_MS: "65432",
      NODEX_INTERNAL_ISOLATED_RUN_ID: RUN_A,
    });
    expect(readIsolatedRunLeaseOwner(nodexHome)).toBeNull();
  });

  test("preserves SIGINT status while allowing cleanup to finish", async () => {
    const nodexHome = createNodexHome();
    const child = new FakeChild();
    const signalSource = new EventEmitter() as unknown as SupervisorSignalSource;
    const signalProcessGroup = vi.fn();

    const resultPromise = superviseIsolatedRun({
      environment: { NODEX_HOME: nodexHome },
      nodexHome,
      repositoryRoot: path.resolve("."),
      runScript: "dev",
      dependencies: {
        cleanupDependencies: cleanupDependencies({
          readClaim: vi.fn(() => null),
        }),
        delay: vi.fn(async () => undefined),
        forceExit: vi.fn(),
        generateRunId: () => RUN_A,
        isProcessGroupAlive: vi.fn(() => false),
        now: vi.fn(() => 0),
        signalSource,
        signalProcessGroup,
        spawnChild: () => {
          queueMicrotask(() => {
            (signalSource as unknown as EventEmitter).emit("SIGINT");
            child.close(0);
          });
          return child.asChildProcess();
        },
      },
    });

    await expect(resultPromise).resolves.toMatchObject({
      childExitCode: 130,
      cleanupStatus: "not_started",
    });
    expect(signalProcessGroup).toHaveBeenCalledWith(4321, "SIGINT");
    expect(readIsolatedRunLeaseOwner(nodexHome)).toBeNull();
  });

  test("terminates remaining application descendants after a normal child exit", async () => {
    const nodexHome = createNodexHome();
    const child = new FakeChild();
    const signalSource = new EventEmitter() as unknown as SupervisorSignalSource;
    const signalProcessGroup = vi.fn();
    const isProcessGroupAlive = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(
      superviseIsolatedRun({
        environment: { NODEX_HOME: nodexHome },
        nodexHome,
        repositoryRoot: path.resolve("."),
        runScript: "dev",
        dependencies: {
          cleanupDependencies: cleanupDependencies({
            readClaim: vi.fn(() => null),
          }),
          delay: vi.fn(async () => undefined),
          forceExit: vi.fn(),
          generateRunId: () => RUN_A,
          isProcessGroupAlive,
          now: vi.fn(() => 0),
          signalSource,
          signalProcessGroup,
          spawnChild: () => {
            queueMicrotask(() => child.close(0));
            return child.asChildProcess();
          },
        },
      }),
    ).resolves.toEqual({
      childExitCode: 0,
      cleanupStatus: "not_started",
      safeToDeleteRunRoot: true,
    });
    expect(signalProcessGroup).toHaveBeenCalledOnce();
    expect(signalProcessGroup).toHaveBeenCalledWith(4321, "SIGTERM");
  });

  test("retains the lease when the foreground process group cannot be terminated", async () => {
    const nodexHome = createNodexHome();
    const child = new FakeChild();
    const signalSource = new EventEmitter() as unknown as SupervisorSignalSource;
    const signalProcessGroup = vi.fn();
    let clock = 0;

    const resultPromise = superviseIsolatedRun({
      environment: { NODEX_HOME: nodexHome },
      nodexHome,
      repositoryRoot: path.resolve("."),
      runScript: "dev",
      dependencies: {
        cleanupDependencies: cleanupDependencies({
          readClaim: vi.fn(() => null),
        }),
        delay: vi.fn(async () => undefined),
        forceExit: vi.fn(),
        generateRunId: () => RUN_A,
        isProcessGroupAlive: vi.fn(() => true),
        now: vi.fn(() => {
          const observed = clock;
          clock += 2_000;
          return observed;
        }),
        signalSource,
        signalProcessGroup,
        spawnChild: () => {
          queueMicrotask(() => {
            (signalSource as unknown as EventEmitter).emit("SIGINT");
            child.close(0);
          });
          return child.asChildProcess();
        },
      },
    });

    await expect(resultPromise).resolves.toMatchObject({
      childExitCode: 130,
      cleanupStatus: "not_started",
      safeToDeleteRunRoot: false,
    });
    expect(signalProcessGroup.mock.calls).toEqual([
      [4321, "SIGINT"],
      [4321, "SIGTERM"],
      [4321, "SIGKILL"],
    ]);
    expect(readIsolatedRunLeaseOwner(nodexHome)?.runId).toBe(RUN_A);
  });

  test("retains a child failure while still performing no-Core cleanup", async () => {
    const nodexHome = createNodexHome();
    const child = new FakeChild();
    const signalSource = new EventEmitter() as unknown as SupervisorSignalSource;

    await expect(
      superviseIsolatedRun({
        environment: { NODEX_HOME: nodexHome },
        nodexHome,
        repositoryRoot: path.resolve("."),
        runScript: "build:run",
        dependencies: {
          cleanupDependencies: cleanupDependencies({
            readClaim: vi.fn(() => null),
          }),
          delay: vi.fn(async () => undefined),
          forceExit: vi.fn(),
          generateRunId: () => RUN_A,
          isProcessGroupAlive: vi.fn(() => false),
          now: vi.fn(() => 0),
          signalSource,
          signalProcessGroup: vi.fn(),
          spawnChild: () => {
            queueMicrotask(() => child.close(7));
            return child.asChildProcess();
          },
        },
      }),
    ).resolves.toMatchObject({
      childExitCode: 7,
      cleanupStatus: "not_started",
    });
    expect(readIsolatedRunLeaseOwner(nodexHome)).toBeNull();
  });
});
