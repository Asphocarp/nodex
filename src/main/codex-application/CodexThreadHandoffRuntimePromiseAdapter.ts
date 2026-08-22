import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexThreadExecutionLocation,
  CodexThreadHandoffJournalEntry,
} from "../codex/codex-thread-handoff-journal";
import {
  CodexThreadHandoffEffectError,
  CodexThreadHandoffRuntimeError,
  type CodexAppHandoffOperation,
  type CodexLaunchThreadHandoffInput,
  type CodexStartThreadHandoffInput,
  type CodexThreadHandoffEffects,
  type CodexThreadHandoffPreparation,
  type CodexThreadHandoffProgress,
  type CodexThreadHandoffRuntime,
} from "./CodexThreadHandoffRuntime";

export interface CodexThreadHandoffPromiseEffects {
  readonly resolveSource: (threadId: string) => Promise<CodexThreadExecutionLocation>;
  readonly readCanonicalLocation: (
    threadId: string,
  ) => Promise<CodexThreadExecutionLocation | null>;
  readonly stopActiveTurn: (threadId: string) => Promise<void>;
  readonly prepareDestination: (
    entry: Parameters<CodexThreadHandoffEffects["prepareDestination"]>[0],
    onPhase: (phase: string, status: "running" | "success" | "error") => void,
  ) => Promise<CodexThreadHandoffPreparation>;
  readonly switchRuntime: (
    threadId: string,
    location: CodexThreadExecutionLocation,
    preparation: CodexThreadHandoffPreparation | null,
  ) => Promise<void>;
  readonly commitLocation: (
    threadId: string,
    location: CodexThreadExecutionLocation,
  ) => Promise<void>;
  readonly projectLocation: (
    threadId: string,
    location: CodexThreadExecutionLocation,
  ) => Promise<void>;
  readonly transferOwner: (
    threadId: string,
    preparation: CodexThreadHandoffPreparation,
  ) => Promise<void>;
  readonly cleanup: (
    preparation: CodexThreadHandoffPreparation,
    outcome: "committed" | "rolled-back",
  ) => Promise<readonly string[]>;
  readonly rollbackPreparation: (
    preparation: CodexThreadHandoffPreparation,
  ) => Promise<readonly string[]>;
  readonly sendFollowUp: (threadId: string, prompt: string) => Promise<void>;
}

export interface CodexThreadHandoffRuntimePromiseAdapter {
  readonly start: (
    input: CodexStartThreadHandoffInput,
    effects: CodexThreadHandoffPromiseEffects,
  ) => Promise<CodexThreadHandoffJournalEntry>;
  readonly recover: (
    effects: CodexThreadHandoffPromiseEffects,
    onProgress?: (progress: CodexThreadHandoffProgress) => void,
  ) => Promise<readonly CodexThreadHandoffJournalEntry[]>;
  readonly launch: (
    input: CodexLaunchThreadHandoffInput,
    effects: CodexThreadHandoffPromiseEffects,
  ) => Promise<CodexAppHandoffOperation>;
  readonly get: (operationId: string) => Promise<CodexAppHandoffOperation | null>;
  readonly waitForRevision: (
    operationId: string,
    afterRevision: number | null,
    waitMs: number,
  ) => Promise<CodexAppHandoffOperation | null>;
}

const toEffectEffects = (
  effects: CodexThreadHandoffPromiseEffects,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "fork">,
): CodexThreadHandoffEffects => {
  const attempt = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({
      try: operation,
      catch: (cause) => new CodexThreadHandoffEffectError({ cause }),
    });
  return {
    resolveSource: (threadId) => attempt(() => effects.resolveSource(threadId)),
    readCanonicalLocation: (threadId) => attempt(() => effects.readCanonicalLocation(threadId)),
    stopActiveTurn: (threadId) => attempt(() => effects.stopActiveTurn(threadId)),
    prepareDestination: (entry, onPhase) =>
      attempt(() =>
        effects.prepareDestination(entry, (phase, status) => {
          callbacks.fork(onPhase(phase, status));
        }),
      ),
    switchRuntime: (threadId, location, preparation) =>
      attempt(() => effects.switchRuntime(threadId, location, preparation)),
    commitLocation: (threadId, location) =>
      attempt(() => effects.commitLocation(threadId, location)),
    projectLocation: (threadId, location) =>
      attempt(() => effects.projectLocation(threadId, location)),
    transferOwner: (threadId, preparation) =>
      attempt(() => effects.transferOwner(threadId, preparation)),
    cleanup: (preparation, outcome) => attempt(() => effects.cleanup(preparation, outcome)),
    rollbackPreparation: (preparation) => attempt(() => effects.rollbackPreparation(preparation)),
    sendFollowUp: (threadId, prompt) => attempt(() => effects.sendFollowUp(threadId, prompt)),
  };
};

const unwrapRuntimeError = (error: unknown): never => {
  if (error instanceof CodexThreadHandoffRuntimeError) throw error.cause;
  throw error;
};

export const makeCodexThreadHandoffRuntimePromiseAdapter = (
  runtime: CodexThreadHandoffRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "fork" | "runPromise">,
): CodexThreadHandoffRuntimePromiseAdapter => {
  const run = <A>(effect: Effect.Effect<A, CodexThreadHandoffRuntimeError>): Promise<A> =>
    callbacks.runPromise(effect).catch(unwrapRuntimeError);
  return {
    start: (input, effects) => run(runtime.start(input, toEffectEffects(effects, callbacks))),
    recover: (effects, onProgress) =>
      run(runtime.recover(toEffectEffects(effects, callbacks), onProgress)),
    launch: (input, effects) =>
      callbacks.runPromise(runtime.launch(input, toEffectEffects(effects, callbacks))),
    get: (operationId) => callbacks.runPromise(runtime.get(operationId)),
    waitForRevision: (operationId, afterRevision, waitMs) =>
      callbacks.runPromise(runtime.waitForRevision(operationId, afterRevision, waitMs)),
  };
};
