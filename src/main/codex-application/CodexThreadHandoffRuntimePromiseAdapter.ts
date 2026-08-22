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
  readonly resolveSource: (
    threadId: string,
    signal: AbortSignal,
  ) => Promise<CodexThreadExecutionLocation>;
  readonly readCanonicalLocation: (
    threadId: string,
    signal: AbortSignal,
  ) => Promise<CodexThreadExecutionLocation | null>;
  readonly stopActiveTurn: (threadId: string, signal: AbortSignal) => Promise<void>;
  readonly prepareDestination: (
    entry: Parameters<CodexThreadHandoffEffects["prepareDestination"]>[0],
    onPhase: (phase: string, status: "running" | "success" | "error") => void,
    signal: AbortSignal,
  ) => Promise<CodexThreadHandoffPreparation>;
  readonly switchRuntime: (
    threadId: string,
    location: CodexThreadExecutionLocation,
    preparation: CodexThreadHandoffPreparation | null,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly commitLocation: (
    threadId: string,
    location: CodexThreadExecutionLocation,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly projectLocation: (
    threadId: string,
    location: CodexThreadExecutionLocation,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly transferOwner: (
    threadId: string,
    preparation: CodexThreadHandoffPreparation,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly cleanup: (
    preparation: CodexThreadHandoffPreparation,
    outcome: "committed" | "rolled-back",
    signal: AbortSignal,
  ) => Promise<readonly string[]>;
  readonly rollbackPreparation: (
    preparation: CodexThreadHandoffPreparation,
    signal: AbortSignal,
  ) => Promise<readonly string[]>;
  readonly sendFollowUp: (threadId: string, prompt: string, signal: AbortSignal) => Promise<void>;
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
  const attempt = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({
      try: operation,
      catch: (cause) => new CodexThreadHandoffEffectError({ cause }),
    });
  return {
    resolveSource: (threadId) => attempt((signal) => effects.resolveSource(threadId, signal)),
    readCanonicalLocation: (threadId) =>
      attempt((signal) => effects.readCanonicalLocation(threadId, signal)),
    stopActiveTurn: (threadId) => attempt((signal) => effects.stopActiveTurn(threadId, signal)),
    prepareDestination: (entry, onPhase) =>
      attempt((signal) =>
        effects.prepareDestination(
          entry,
          (phase, status) => {
            callbacks.fork(onPhase(phase, status));
          },
          signal,
        ),
      ),
    switchRuntime: (threadId, location, preparation) =>
      attempt((signal) => effects.switchRuntime(threadId, location, preparation, signal)),
    commitLocation: (threadId, location) =>
      attempt((signal) => effects.commitLocation(threadId, location, signal)),
    projectLocation: (threadId, location) =>
      attempt((signal) => effects.projectLocation(threadId, location, signal)),
    transferOwner: (threadId, preparation) =>
      attempt((signal) => effects.transferOwner(threadId, preparation, signal)),
    cleanup: (preparation, outcome) =>
      attempt((signal) => effects.cleanup(preparation, outcome, signal)),
    rollbackPreparation: (preparation) =>
      attempt((signal) => effects.rollbackPreparation(preparation, signal)),
    sendFollowUp: (threadId, prompt) =>
      attempt((signal) => effects.sendFollowUp(threadId, prompt, signal)),
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
