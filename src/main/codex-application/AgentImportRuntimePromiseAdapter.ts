import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { AgentImportRuntimeError, type AgentImportRuntime } from "./AgentImportRuntime";
import type {
  AgentImportApplyInput,
  AgentImportResult,
  AgentImportScan,
  AgentImportSourceKind,
} from "../../shared/agent-import";

export interface AgentImportRuntimePromiseAdapter {
  readonly scan: (
    sourceKind: AgentImportSourceKind,
    selectedSourceHome?: string,
  ) => Promise<AgentImportScan>;
  readonly apply: (input: AgentImportApplyInput) => Promise<AgentImportResult>;
}

export const makeAgentImportRuntimePromiseAdapter = (
  runtime: AgentImportRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): AgentImportRuntimePromiseAdapter => {
  const unwrap = <Value>(promise: Promise<Value>): Promise<Value> =>
    promise.catch((error: unknown) => {
      if (error instanceof AgentImportRuntimeError) throw error.cause;
      throw error;
    });
  return {
    scan: (sourceKind, selectedSourceHome) =>
      unwrap(callbacks.runPromise(runtime.scan(sourceKind, selectedSourceHome))),
    apply: (input) => unwrap(callbacks.runPromise(runtime.apply(input))),
  };
};
