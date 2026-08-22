import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexThreadTitlePersistenceEffectError,
  type CodexThreadTitlePersistence,
  type CodexThreadTitleSetCommand,
} from "./CodexThreadTitlePersistence";

export interface CodexThreadTitlePersistencePromiseAdapter {
  readonly set: (input: CodexThreadTitleSetCommand) => Promise<boolean>;
  readonly setRequired: (input: CodexThreadTitleSetCommand) => Promise<boolean>;
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
  set: (input) => callbacks.runPromise(persistence.set(input)).catch(unwrapPersistenceError),
  setRequired: (input) =>
    callbacks.runPromise(persistence.setRequired(input)).catch(unwrapPersistenceError),
});
