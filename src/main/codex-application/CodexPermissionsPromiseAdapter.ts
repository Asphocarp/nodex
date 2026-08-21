import type { CodexPermissionMode, CodexPermissionState } from "../../shared/types";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexPermissionDecision, CodexPermissions } from "./CodexPermissions";

export interface CodexPermissionsPromiseAdapter {
  readonly snapshot: (projectId: string | null) => Promise<CodexPermissionState>;
  readonly resolve: (input: {
    readonly projectId: string | null;
    readonly requestedMode?: CodexPermissionMode;
    readonly workspaceRoots: readonly string[];
  }) => Promise<CodexPermissionDecision>;
  readonly resolveAutomation: (workspaceRoots: readonly string[]) => Promise<CodexPermissionState>;
}

export const makeCodexPermissionsPromiseAdapter = (
  permissions: CodexPermissions["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): CodexPermissionsPromiseAdapter => ({
  snapshot: (projectId) => callbacks.runPromise(permissions.snapshot(projectId)),
  resolve: (input) => callbacks.runPromise(permissions.resolve(input)),
  resolveAutomation: (workspaceRoots) =>
    callbacks.runPromise(permissions.resolveAutomation(workspaceRoots)),
});
