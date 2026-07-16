import {
  executePageLifecycleIntent,
  type PageLifecycleExecutionResult,
  type PageLifecycleIntent,
  type PageLifecycleRuntimeDependencies,
} from "../../shared/page-lifecycle-runtime";
import {
  invoke,
  mutatePageLifecycle,
  readPageLifecyclePreflight,
} from "./api";
import type { DatabasePage } from "./types";

const defaultDependencies: PageLifecycleRuntimeDependencies = {
  readPreflight: readPageLifecyclePreflight,
  mutate: mutatePageLifecycle,
  readBoardProjection: async (projectId, pageId) =>
    (await invoke("database-row:get", projectId, pageId)) as DatabasePage | null,
  waitBeforeCanonicalReadRetry: async () => {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  },
};

export const commitPageLifecycleIntent = async (
  intent: PageLifecycleIntent,
  dependencies: PageLifecycleRuntimeDependencies = defaultDependencies,
): Promise<PageLifecycleExecutionResult> =>
  await executePageLifecycleIntent(intent, dependencies);
