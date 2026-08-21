import { randomUUID } from "node:crypto";

import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type {
  BeginNodexAgentTurnAuthorityInput,
  CaptureNodexAgentTurnAuthorityInput,
  NodexAgentAuthorityPort,
  NodexAgentTurnAuthorityLaunch,
} from "../nodex-agent-authority-port";
import { FULL_ACCESS_PERMISSION_PROFILE_ID } from "../codex/codex-permission-resolver";
import { CoreModuleResponseError } from "./core-client";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "./desktop-data-authority";
import type { ProjectWorkspaceReadSnapshot } from "./types";

type CoreTurnAuthority = NonNullable<
  Extract<
    ProjectWorkspaceReadSnapshot["value"],
    { readonly kind: "turn_authority" }
  >["resolution"]["authority"]
>;

const normalizeIdentity = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : null;
};

const isNotFound = (error: unknown): boolean =>
  error instanceof CoreModuleResponseError && error.coreError.code === "not_found";

const fromCoreAuthority = (authority: CoreTurnAuthority): FrozenNodexAgentTurnAuthority => ({
  threadId: authority.thread_id,
  turnId: authority.turn_id,
  rootThreadId: authority.root_thread_id,
  actorProjectId: authority.actor_project_id,
  libraryId: authority.library_id,
  storeEpoch: authority.store_epoch,
  scope: authority.scope,
  source: authority.source,
});

const createCoreNodexAgentAuthorityPort = (
  runtime: RustDataAuthorityRuntime,
): NodexAgentAuthorityPort => {
  const pendingByThreadId = new Map<string, NodexAgentTurnAuthorityLaunch[]>();

  const removePending = (launch: NodexAgentTurnAuthorityLaunch): void => {
    const pending = pendingByThreadId.get(launch.snapshot.threadId);
    if (!pending) return;
    const next = pending.filter((candidate) => candidate !== launch);
    if (next.length === 0) {
      pendingByThreadId.delete(launch.snapshot.threadId);
      return;
    }
    pendingByThreadId.set(launch.snapshot.threadId, next);
  };

  const readResolution = async (input: CaptureNodexAgentTurnAuthorityInput) => {
    const snapshot = await runtime.clientForProject(input.actorProjectId).workspaceRead({
      kind: "turn_authority",
      thread_id: input.threadId,
      turn_id: input.turnId,
      root_thread_id: input.rootThreadId,
      actor_project_id: input.actorProjectId,
    });
    if (snapshot.value.kind !== "turn_authority") {
      throw new Error("Core returned the wrong Turn authority read variant");
    }
    return snapshot.value.resolution;
  };

  const beginTurn = async (
    input: BeginNodexAgentTurnAuthorityInput,
  ): Promise<NodexAgentTurnAuthorityLaunch | null> => {
    const threadId = normalizeIdentity(input.threadId);
    const rootThreadId = normalizeIdentity(input.rootThreadId);
    const actorProjectId = normalizeIdentity(input.actorProjectId);
    if (!threadId || !rootThreadId || !actorProjectId) return null;

    let projectSnapshot: ProjectWorkspaceReadSnapshot;
    try {
      projectSnapshot = await runtime
        .clientForProject(actorProjectId)
        .workspaceRead({ kind: "project", project_id: actorProjectId });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (projectSnapshot.value.kind !== "project") {
      throw new Error("Core returned the wrong Project authority read variant");
    }
    const project = projectSnapshot.value.project;
    if (project.library_id !== runtime.identity.libraryId) {
      return null;
    }

    const inherited = input.inheritedAuthority;
    const inheritsLibraryAuthority =
      inherited?.scope === "library" &&
      inherited.actorProjectId === actorProjectId &&
      inherited.libraryId === project.library_id &&
      inherited.storeEpoch === runtime.identity.storeEpoch;
    const scope = input.builtinFullAccess || inheritsLibraryAuthority ? "library" : "project";
    const source = input.builtinFullAccess
      ? "builtin_full_access"
      : inheritsLibraryAuthority
        ? "inherited_builtin_full_access"
        : "project_turn";
    const launch: NodexAgentTurnAuthorityLaunch = {
      launchId: randomUUID(),
      snapshot: {
        threadId,
        rootThreadId,
        actorProjectId,
        libraryId: project.library_id,
        profileId: runtime.identity.profileId,
        storeEpoch: runtime.identity.storeEpoch,
        scope,
        source,
        permissionProfileId: scope === "library" ? FULL_ACCESS_PERMISSION_PROFILE_ID : null,
        ...(inheritsLibraryAuthority && inherited
          ? {
              inheritedFrom: {
                threadId: inherited.threadId,
                turnId: inherited.turnId,
              },
            }
          : {}),
      },
      boundTurnId: null,
      aborted: false,
    };
    const pending = pendingByThreadId.get(threadId) ?? [];
    pending.push(launch);
    pendingByThreadId.set(threadId, pending);
    return launch;
  };

  const capturePersisted = async (
    input: CaptureNodexAgentTurnAuthorityInput,
  ): Promise<FrozenNodexAgentTurnAuthority | null> => {
    const resolution = await readResolution(input);
    if (!resolution.persisted || !resolution.authority) return null;
    return fromCoreAuthority(resolution.authority);
  };

  const bindTurn = async (
    launch: NodexAgentTurnAuthorityLaunch | null,
    rawTurnId: string,
  ): Promise<FrozenNodexAgentTurnAuthority | null> => {
    if (!launch || launch.aborted) return null;
    const turnId = normalizeIdentity(rawTurnId);
    if (!turnId) return null;
    if (launch.boundTurnId && launch.boundTurnId !== turnId) {
      throw new Error(
        `Nodex Agent authority launch ${launch.launchId} is already bound to Turn ${launch.boundTurnId}`,
      );
    }
    const captureInput = {
      threadId: launch.snapshot.threadId,
      turnId,
      rootThreadId: launch.snapshot.rootThreadId,
      actorProjectId: launch.snapshot.actorProjectId,
    };
    if (!launch.boundTurnId) {
      await runtime.clientForProject(launch.snapshot.actorProjectId).workspaceApply({
        operationId: `electron:turn-authority:${launch.launchId}:${turnId}`,
        intent: {
          kind: "freeze_turn_authority",
          thread_id: launch.snapshot.threadId,
          turn_id: turnId,
          root_thread_id: launch.snapshot.rootThreadId,
          actor_project_id: launch.snapshot.actorProjectId,
          source: launch.snapshot.source,
          ...(launch.snapshot.inheritedFrom
            ? {
                inherited_from: {
                  thread_id: launch.snapshot.inheritedFrom.threadId,
                  turn_id: launch.snapshot.inheritedFrom.turnId,
                },
              }
            : {}),
        },
      });
    }
    const authority = await capturePersisted(captureInput);
    if (!authority) {
      throw new Error("Core did not persist the exact Turn authority");
    }
    launch.boundTurnId = turnId;
    removePending(launch);
    return authority;
  };

  const observeTurnStarted = async (
    rawThreadId: string,
    rawTurnId: string,
  ): Promise<FrozenNodexAgentTurnAuthority | null> => {
    const threadId = normalizeIdentity(rawThreadId);
    if (!threadId) return null;
    const launch = pendingByThreadId.get(threadId)?.find((candidate) => !candidate.aborted) ?? null;
    return await bindTurn(launch, rawTurnId);
  };

  const abortTurn = (launch: NodexAgentTurnAuthorityLaunch | null): void => {
    if (!launch || launch.boundTurnId) return;
    launch.aborted = true;
    removePending(launch);
  };

  const inheritTurn = async (
    input: CaptureNodexAgentTurnAuthorityInput,
    inheritedAuthority: FrozenNodexAgentTurnAuthority,
  ): Promise<FrozenNodexAgentTurnAuthority | null> => {
    const launch = await beginTurn({
      threadId: input.threadId,
      rootThreadId: input.rootThreadId,
      actorProjectId: input.actorProjectId,
      builtinFullAccess: false,
      inheritedAuthority,
    });
    if (!launch || launch.snapshot.scope !== "library") {
      abortTurn(launch);
      return null;
    }
    try {
      return await bindTurn(launch, input.turnId);
    } catch (error) {
      abortTurn(launch);
      throw error;
    }
  };

  const capture = async (
    input: CaptureNodexAgentTurnAuthorityInput,
  ): Promise<FrozenNodexAgentTurnAuthority | null> => {
    const resolution = await readResolution(input);
    if (resolution.persisted) {
      return resolution.authority ? fromCoreAuthority(resolution.authority) : null;
    }
    const launch =
      pendingByThreadId.get(input.threadId)?.find((candidate) => !candidate.aborted) ?? null;
    if (launch) return await bindTurn(launch, input.turnId);
    return resolution.authority ? fromCoreAuthority(resolution.authority) : null;
  };

  return {
    beginTurn,
    bindTurn,
    observeTurnStarted,
    abortTurn,
    inheritTurn,
    capturePersisted,
    hasRecordedAuthority: async (input) => (await readResolution(input)).persisted,
    capture,
  };
};

export interface DesktopNodexAgentAuthorityInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export const createDesktopNodexAgentAuthorityPort = (
  input: DesktopNodexAgentAuthorityInput,
): NodexAgentAuthorityPort => {
  let corePort: NodexAgentAuthorityPort | null = null;
  const resolve = async (): Promise<NodexAgentAuthorityPort> => {
    const runtime = await input.authority;
    corePort ??= createCoreNodexAgentAuthorityPort(runtime);
    return corePort;
  };

  return {
    beginTurn: async (beginInput) => await (await resolve()).beginTurn(beginInput),
    bindTurn: async (launch, turnId) => await (await resolve()).bindTurn(launch, turnId),
    observeTurnStarted: async (threadId, turnId) =>
      await (await resolve()).observeTurnStarted(threadId, turnId),
    abortTurn: (launch) => {
      if (launch) launch.aborted = true;
      void resolve().then((port) => port.abortTurn(launch));
    },
    inheritTurn: async (inheritInput, inheritedAuthority) =>
      await (await resolve()).inheritTurn(inheritInput, inheritedAuthority),
    capturePersisted: async (captureInput) =>
      await (await resolve()).capturePersisted(captureInput),
    hasRecordedAuthority: async (captureInput) =>
      await (await resolve()).hasRecordedAuthority(captureInput),
    capture: async (captureInput) => await (await resolve()).capture(captureInput),
  };
};
