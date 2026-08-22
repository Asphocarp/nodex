import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexSidebarSyncError,
  type CodexSidebarSyncNotification,
  type CodexSidebarProjectionInput,
  type CodexSidebarSyncInput,
  type CodexSidebarSyncRuntime,
} from "./CodexSidebarSyncRuntime";
import type { CodexSidebarSyncResult } from "../../shared/types";

export interface CodexSidebarSyncRuntimePromiseAdapter {
  readonly sync: (input?: CodexSidebarSyncInput) => Promise<CodexSidebarSyncResult>;
  readonly publish: (input: CodexSidebarProjectionInput) => Promise<CodexSidebarSyncResult>;
  readonly invalidate: () => void;
  readonly scheduleNotification: (request: CodexSidebarSyncNotification) => void;
}

const unwrap = <A>(promise: Promise<A>): Promise<A> =>
  promise.catch((error: unknown) => {
    if (error instanceof CodexSidebarSyncError) throw error.cause;
    throw error;
  });

export const makeCodexSidebarSyncRuntimePromiseAdapter = (
  runtime: CodexSidebarSyncRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexSidebarSyncRuntimePromiseAdapter => ({
  sync: (input) => unwrap(callbacks.runPromise(runtime.sync(input))),
  publish: (input) => unwrap(callbacks.runPromise(runtime.publish(input))),
  invalidate: runtime.invalidate,
  scheduleNotification: runtime.scheduleNotification,
});
