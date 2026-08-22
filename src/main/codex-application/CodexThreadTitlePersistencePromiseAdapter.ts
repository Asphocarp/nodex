import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexThreadTitlePersistenceEffectError,
  type CodexThreadTitlePersistence,
  type CodexThreadTitlePersistenceInput,
} from "./CodexThreadTitlePersistence";

export interface CodexThreadTitlePersistencePromiseAdapter {
  readonly persistBestEffort: (input: CodexThreadTitlePersistenceInput) => Promise<void>;
  readonly persistRequired: (input: CodexThreadTitlePersistenceInput) => Promise<void>;
}

const unwrapPersistenceError = (error: unknown): never => {
  if (error instanceof CodexThreadTitlePersistenceEffectError) throw error.cause;
  throw error;
};

/** Promise projection for CodexService; it owns no queue, failure policy, or lifecycle. */
export const makeCodexThreadTitlePersistencePromiseAdapter = (
  persistence: CodexThreadTitlePersistence["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexThreadTitlePersistencePromiseAdapter => ({
  persistBestEffort: (input) => callbacks.runPromise(persistence.persistBestEffort(input)),
  persistRequired: (input) =>
    callbacks.runPromise(persistence.persistRequired(input)).catch(unwrapPersistenceError),
});
