import type {
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "@nodex/codex-app-server-protocol/v2";
import type { CodexSteerTurnInput, CodexTurnSummary } from "../../shared/types";
import type {
  CodexPreparedTurnStart,
  CodexPreparedTurnSteer,
  CodexTurnStartOverrides,
} from "../codex-application/CodexTurnCommands";
import type { CodexTurnCommandsPromiseAdapter } from "../codex-application/CodexTurnCommandsPromiseAdapter";
import type { CodexGatewayPromiseClient } from "../codex-runtime/CodexGatewayPromiseAdapter";
import { CodexRpcError } from "../codex-runtime/CodexGatewayPromiseAdapter";

interface TestCodexTurnCommandProjection {
  readonly prepareStart: (input: {
    readonly threadId: string;
    readonly prompt: string;
    readonly overrides?: CodexTurnStartOverrides;
    readonly rendererOwnsState: boolean;
    readonly syncDormantConversationUpdates: boolean;
    readonly signal: AbortSignal;
  }) => Promise<CodexPreparedTurnStart>;
  readonly beginStart: (prepared: CodexPreparedTurnStart) => Promise<void>;
  readonly recoverStart: (
    prepared: CodexPreparedTurnStart,
    signal: AbortSignal,
  ) => Promise<CodexPreparedTurnStart["request"]>;
  readonly commitStart: (
    prepared: CodexPreparedTurnStart,
    response: TurnStartResponse,
  ) => Promise<CodexTurnSummary | TurnStartResponse | null>;
  readonly rollbackStart: (prepared: CodexPreparedTurnStart) => void;
  readonly prepareSteer: (input: {
    readonly command: CodexSteerTurnInput;
    readonly steerId: string;
    readonly syncDormantConversationUpdates: boolean;
    readonly signal: AbortSignal;
  }) => Promise<CodexPreparedTurnSteer>;
  readonly beginSteer: (prepared: CodexPreparedTurnSteer) => void;
  readonly commitSteer: (
    prepared: CodexPreparedTurnSteer,
    response: TurnSteerResponse,
  ) => Promise<{ readonly turnId: string } | null>;
  readonly rollbackSteer: (prepared: CodexPreparedTurnSteer) => void;
}

const makeKeyedLane = () => {
  const tails = new Map<string, Promise<void>>();
  return async <A>(key: string, operation: () => Promise<A>): Promise<A> => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
};

const isThreadNotFound = (error: unknown): boolean => {
  if (!(error instanceof CodexRpcError)) return false;
  const message = error.message.toLowerCase();
  return message.includes("thread") && message.includes("not found");
};

const isSteerTurnInactive = (error: unknown): boolean => {
  if (!(error instanceof CodexRpcError)) return false;
  const info =
    typeof error.data === "object" && error.data !== null
      ? (error.data as Record<string, unknown>).codexErrorInfo
      : null;
  if (typeof info === "object" && info !== null && "activeTurnNotSteerable" in info) return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("steerturninactiveerror") ||
    message.includes("active turn not steerable") ||
    (message.includes("active turn") && message.includes("not") && message.includes("steer"))
  );
};

/**
 * Promise interpreter for the legacy CodexService fixture. Production command semantics are
 * exercised by CodexTurnCommands.node.test.ts; this adapter keeps Effect runners out of Vitest.
 */
export const makeCodexTurnCommandsTestAdapter = (input: {
  readonly client: CodexGatewayPromiseClient;
  readonly projectLifecycle: {
    readonly runExclusive: <A>(
      projectId: string | null,
      operation: () => A | Promise<A>,
    ) => Promise<A>;
  };
  readonly projection: TestCodexTurnCommandProjection;
}): CodexTurnCommandsPromiseAdapter => {
  const runInThread = makeKeyedLane();

  const startTransaction = async (
    threadId: string,
    prompt: string,
    overrides: CodexTurnStartOverrides | undefined,
    rendererOwnsState: boolean,
    syncDormantConversationUpdates: boolean,
  ): Promise<CodexTurnSummary | TurnStartResponse | null> => {
    const controller = new AbortController();
    const prepared = await input.projection.prepareStart({
      threadId,
      prompt,
      ...(overrides ? { overrides } : {}),
      rendererOwnsState,
      syncDormantConversationUpdates,
      signal: controller.signal,
    });
    return await input.projectLifecycle.runExclusive(prepared.projectId, async () => {
      try {
        await input.projection.beginStart(prepared);
        let response: TurnStartResponse;
        try {
          response = await input.client.request<"turn/start", TurnStartResponse>(
            "turn/start",
            prepared.request,
          );
        } catch (error) {
          if (rendererOwnsState || !isThreadNotFound(error)) throw error;
          const retry = await input.projection.recoverStart(prepared, controller.signal);
          response = await input.client.request<"turn/start", TurnStartResponse>(
            "turn/start",
            retry,
          );
        }
        return await input.projection.commitStart(prepared, response);
      } catch (error) {
        input.projection.rollbackStart(prepared);
        throw error;
      }
    });
  };

  return {
    start: (threadId, prompt, overrides, options) =>
      runInThread(threadId, () =>
        startTransaction(
          threadId,
          prompt,
          overrides,
          false,
          options?.syncDormantConversationUpdates ?? true,
        ),
      ) as Promise<CodexTurnSummary | null>,
    startRendererOwned: (threadId, prompt, overrides) =>
      runInThread(threadId, () =>
        startTransaction(threadId, prompt, overrides, true, false),
      ) as Promise<TurnStartResponse>,
    steer: (command, options) =>
      runInThread(command.threadId, async () => {
        const controller = new AbortController();
        const prepared = await input.projection.prepareSteer({
          command,
          steerId: `steer:${command.threadId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          syncDormantConversationUpdates: options?.syncDormantConversationUpdates ?? true,
          signal: controller.signal,
        });
        try {
          input.projection.beginSteer(prepared);
          const response = await input.client.request<"turn/steer", TurnSteerResponse>(
            "turn/steer",
            prepared.request,
          );
          return await input.projection.commitSteer(prepared, response);
        } catch (error) {
          input.projection.rollbackSteer(prepared);
          if (!isSteerTurnInactive(error)) throw error;
          const restarted = await startTransaction(
            prepared.threadId,
            prepared.fallbackStart.prompt,
            prepared.fallbackStart.overrides,
            false,
            prepared.fallbackStart.syncDormantConversationUpdates,
          );
          return restarted && "turnId" in restarted && restarted.turnId
            ? { turnId: restarted.turnId }
            : null;
        }
      }),
    steerRendererOwned: (params: TurnSteerParams) =>
      runInThread(params.threadId, () =>
        input.client.request<"turn/steer", TurnSteerResponse>("turn/steer", params),
      ),
  };
};
