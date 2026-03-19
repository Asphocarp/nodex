import { useMemo } from "react";
import { buildThreadStageModel } from "./projection/build-thread-stage-model";
import type { ThreadStageActions, ThreadStageModelInput } from "./thread-stage-types";

export function useThreadStageModel(input: ThreadStageModelInput, actions: ThreadStageActions) {
  const model = useMemo(() => buildThreadStageModel(input), [input]);
  return { model, actions };
}
