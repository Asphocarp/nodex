import { describe, expect, test, vi } from "vitest";

import type {
  CoreGenerationClient,
  CoreGenerationLaunch,
} from "./desktop-core-authority-supervisor";
import {
  CoreAuthorityUnavailableError,
  DesktopCoreAuthoritySupervisor,
} from "./desktop-core-authority-supervisor";
import type {
  LibraryApplyInput,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadSnapshot,
} from "./types";
import { CoreTransportError } from "./uds-http";
import {
  createFakeCoreHandshake,
  FakeCoreClient,
} from "./testing/fake-core-client";

interface GenerationBehavior {
  readonly apply?: (input: LibraryApplyInput) => Promise<LibraryCommittedValue>;
  readonly read: (read: LibraryRead) => Promise<LibraryReadSnapshot>;
}

const readyHealth = (
  pid: number,
  startNonce: string,
): Awaited<ReturnType<CoreGenerationClient["health"]>> => ({
  pid,
  start_nonce: startNonce,
  status: "ready",
} as Awaited<ReturnType<CoreGenerationClient["health"]>>);

const generationClient = (input: {
  readonly behavior: GenerationBehavior;
  readonly generation: number;
  readonly libraryId?: string;
  readonly profileId?: string;
  readonly storeEpoch?: string;
}): CoreGenerationClient => {
  const startNonce = `generation-${input.generation}`;
  const handshake = createFakeCoreHandshake({
    profileId: input.profileId ?? "profile-a",
    libraryId: input.libraryId ?? "library-a",
    storeEpoch: input.storeEpoch ?? "epoch-a",
    connectionBinding: `binding-${input.generation}`,
  });
  const resolvedHandshake = {
    ...handshake,
    generation: {
      ...handshake.generation,
      pid: input.generation,
      readiness_generation: input.generation,
      start_nonce: startNonce,
    },
  };
  const client = new FakeCoreClient();
  return Object.assign(client, {
    handshake: resolvedHandshake,
    forProject: () => generationClient(input),
    health: async () => readyHealth(input.generation, startNonce),
    libraryApply: input.behavior.apply
      ?? (async () => {
        throw new Error("No apply behavior configured");
      }),
    libraryRead: input.behavior.read,
    shutdown: async () => ({ status: "draining" as const }),
  });
};

const launch = (client: CoreGenerationClient): CoreGenerationLaunch => ({
  client,
  executablePath: "/tmp/nodex-core",
  startedProcessId: null,
  timings: {
    artifactValidationMs: 0,
    connectMs: 0,
    disposition: "reused",
    reason: "reused_compatible",
    selectionMs: 0,
    totalMs: 0,
  },
});

const createSupervisor = (
  initialClient: CoreGenerationClient,
  launchNext: () => Promise<CoreGenerationLaunch>,
): DesktopCoreAuthoritySupervisor => new DesktopCoreAuthoritySupervisor({
  initialLaunch: launch(initialClient),
  launchInput: {
    buildId: "supervisor-test",
    isPackaged: false,
    nodexHome: "/tmp/nodex-supervisor-test",
  },
  dependencies: { launch: launchNext },
});

const metadataRead: LibraryRead = { kind: "metadata" };
const snapshot = (generation: number): LibraryReadSnapshot => ({
  contract_version: 6,
  event_head: generation,
  store_epoch: "epoch-a",
  value: {
    change_log_seq: generation,
    kind: "metadata",
    library_id: "library-a",
    profile_id: "profile-a",
  },
});

const lostGeneration = (): CoreTransportError =>
  new CoreTransportError("unreachable", "connect", "ECONNREFUSED", null);

describe("DesktopCoreAuthoritySupervisor", () => {
  test("coalesces concurrent generation-loss recovery and preserves stable facades", async () => {
    const initial = generationClient({
      generation: 1,
      behavior: { read: async () => { throw lostGeneration(); } },
    });
    const replacement = generationClient({
      generation: 2,
      behavior: { read: async () => snapshot(2) },
    });
    const launchNext = vi.fn(async () => launch(replacement));
    const supervisor = createSupervisor(initial, launchNext);
    const projectClient = supervisor.clientForProject("project-a");

    const results = await Promise.all(
      Array.from({ length: 50 }, () => projectClient.libraryRead(metadataRead)),
    );

    expect(launchNext).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.event_head === 2)).toBe(true);
    expect(supervisor.clientForProject("project-a")).toBe(projectClient);
    expect(projectClient.handshake.generation.pid).toBe(2);
    expect(supervisor.state.kind).toBe("ready");
  });

  test("accepts a fresh connection to the same Core generation", async () => {
    const initial = generationClient({
      generation: 1,
      behavior: { read: async () => { throw lostGeneration(); } },
    });
    const rebound = generationClient({
      generation: 1,
      behavior: { read: async () => snapshot(1) },
    });
    const supervisor = createSupervisor(initial, async () => launch(rebound));

    await expect(supervisor.rootClient.libraryRead(metadataRead))
      .resolves.toMatchObject({ event_head: 1 });
    expect(supervisor.rootClient.handshake.connection_binding).toBe("binding-1");
  });

  test("joins the current recovery when an older session fails late", async () => {
    let rejectLateRead: (error: unknown) => void = () => undefined;
    let initialReads = 0;
    const initial = generationClient({
      generation: 1,
      behavior: {
        read: async () => {
          initialReads += 1;
          if (initialReads > 1) throw lostGeneration();
          return await new Promise<LibraryReadSnapshot>((_resolve, reject) => {
            rejectLateRead = reject;
          });
        },
      },
    });
    let reboundReads = 0;
    const rebound = generationClient({
      generation: 2,
      behavior: {
        read: async () => {
          reboundReads += 1;
          if (reboundReads > 1) throw lostGeneration();
          return snapshot(2);
        },
      },
    });
    const stable = generationClient({
      generation: 3,
      behavior: { read: async () => snapshot(3) },
    });
    let resolveStable: (value: CoreGenerationLaunch) => void = () => undefined;
    const launchNext = vi.fn()
      .mockResolvedValueOnce(launch(rebound))
      .mockImplementationOnce(async () => await new Promise<CoreGenerationLaunch>((resolve) => {
        resolveStable = resolve;
      }));
    const supervisor = createSupervisor(initial, launchNext);

    const lateRead = supervisor.rootClient.libraryRead(metadataRead);
    await vi.waitFor(() => expect(initialReads).toBe(1));
    await expect(supervisor.rootClient.libraryRead(metadataRead))
      .resolves.toMatchObject({ event_head: 2 });

    const reboundRead = supervisor.rootClient.libraryRead(metadataRead);
    await vi.waitFor(() => expect(launchNext).toHaveBeenCalledTimes(2));
    rejectLateRead(lostGeneration());
    resolveStable(launch(stable));

    await expect(reboundRead).resolves.toMatchObject({ event_head: 3 });
    await expect(lateRead).resolves.toMatchObject({ event_head: 3 });
  });

  test("close fences an in-flight recovery before health, adoption, and replay", async () => {
    const initial = generationClient({
      generation: 1,
      behavior: {
        read: async () => snapshot(1),
        apply: async () => { throw lostGeneration(); },
      },
    });
    const replacementApply = vi.fn(async () => ({
      event_sequence: 2,
      value: { kind: "project_deleted" },
    } as unknown as LibraryCommittedValue));
    const replacement = generationClient({
      generation: 2,
      behavior: {
        read: async () => snapshot(2),
        apply: replacementApply,
      },
    });
    let resolveLaunch: (value: CoreGenerationLaunch) => void = () => undefined;
    const launchNext = vi.fn(async () => await new Promise<CoreGenerationLaunch>((resolve) => {
      resolveLaunch = resolve;
    }));
    const supervisor = createSupervisor(initial, launchNext);
    const pending = supervisor.rootClient.libraryApply({
      operationId: "close-fenced-operation",
      intent: { kind: "delete_project", project_id: "project-a" },
    } as unknown as LibraryApplyInput);
    const rejected = expect(pending).rejects.toMatchObject({
      authorityState: { kind: "stopped" },
    });

    await vi.waitFor(() => expect(launchNext).toHaveBeenCalledTimes(1));
    supervisor.close();
    resolveLaunch(launch(replacement));

    await rejected;
    expect(supervisor.state).toEqual({ kind: "stopped" });
    expect(replacementApply).not.toHaveBeenCalled();
  });

  test("fails closed when recovery crosses the Store epoch boundary", async () => {
    const initial = generationClient({
      generation: 1,
      behavior: { read: async () => { throw lostGeneration(); } },
    });
    const incompatible = generationClient({
      generation: 2,
      storeEpoch: "epoch-b",
      behavior: { read: async () => snapshot(2) },
    });
    const supervisor = createSupervisor(initial, async () => launch(incompatible));

    await expect(supervisor.rootClient.libraryRead(metadataRead))
      .rejects.toThrow(CoreAuthorityUnavailableError);
    expect(supervisor.state).toMatchObject({
      circuitOpen: false,
      kind: "unavailable",
    });
    expect(supervisor.rootClient.handshake.store_epoch).toBe("epoch-a");
  });

  test("does not treat an ambiguous timeout as generation loss", async () => {
    const timeout = new CoreTransportError(
      "timeout",
      "response",
      "ETIMEDOUT",
      null,
    );
    const initial = generationClient({
      generation: 1,
      behavior: { read: async () => { throw timeout; } },
    });
    const launchNext = vi.fn(async () => launch(initial));
    const supervisor = createSupervisor(initial, launchNext);

    await expect(supervisor.rootClient.libraryRead(metadataRead)).rejects.toBe(timeout);
    expect(launchNext).not.toHaveBeenCalled();
    expect(supervisor.state.kind).toBe("ready");
  });

  test("replays the exact idempotent operation once after rebinding", async () => {
    const observedInputs: LibraryApplyInput[] = [];
    const initial = generationClient({
      generation: 1,
      behavior: {
        read: async () => snapshot(1),
        apply: async (input) => {
          observedInputs.push(input);
          throw lostGeneration();
        },
      },
    });
    const committed = ({
      event_sequence: 5,
      value: { kind: "project_deleted" },
    } as unknown as LibraryCommittedValue);
    const replacement = generationClient({
      generation: 2,
      behavior: {
        read: async () => snapshot(2),
        apply: async (input) => {
          observedInputs.push(input);
          return committed;
        },
      },
    });
    const supervisor = createSupervisor(initial, async () => launch(replacement));
    const operation = {
      operationId: "stable-operation-id",
      intent: { kind: "delete_project", project_id: "project-a" },
    } as unknown as LibraryApplyInput;

    await expect(supervisor.rootClient.libraryApply(operation)).resolves.toBe(committed);
    expect(observedInputs).toEqual([operation, operation]);
  });

  test("opens its circuit across independent rebound sessions to one generation", async () => {
    const clients = [1, 2, 3].map(() => generationClient({
      generation: 1,
      behavior: { read: async () => { throw lostGeneration(); } },
    }));
    const replacements = clients.slice(1);
    const launchNext = vi.fn(async () => launch(
      replacements.shift() ?? clients[2]!,
    ));
    const supervisor = createSupervisor(clients[0]!, launchNext);

    await expect(supervisor.rootClient.libraryRead(metadataRead)).rejects.toThrow(
      CoreTransportError,
    );
    await expect(supervisor.rootClient.libraryRead(metadataRead)).rejects.toThrow(
      CoreTransportError,
    );
    await expect(supervisor.rootClient.libraryRead(metadataRead)).rejects.toThrow(
      CoreAuthorityUnavailableError,
    );

    expect(launchNext).toHaveBeenCalledTimes(2);
    expect(supervisor.state).toMatchObject({
      circuitOpen: true,
      kind: "unavailable",
    });
  });
});
