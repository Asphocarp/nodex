import {
  executeCardLifecycleIntent,
  type CardLifecycleExecutionResult,
  type CardLifecycleIntent,
  type CardLifecycleRuntimeDependencies,
} from "../../shared/card-lifecycle-runtime";
import {
  invoke,
  mutateCardLifecycle,
  readCardLifecyclePreflight,
} from "./api";
import type { Card } from "./types";

const defaultDependencies: CardLifecycleRuntimeDependencies = {
  readPreflight: readCardLifecyclePreflight,
  mutate: mutateCardLifecycle,
  readCard: async (projectId, cardId) =>
    (await invoke("database-row:get", projectId, cardId)) as Card | null,
  waitBeforeCanonicalReadRetry: async () => {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  },
};

export const commitCardLifecycleIntent = async (
  intent: CardLifecycleIntent,
  dependencies: CardLifecycleRuntimeDependencies = defaultDependencies,
): Promise<CardLifecycleExecutionResult> =>
  await executeCardLifecycleIntent(intent, dependencies);
