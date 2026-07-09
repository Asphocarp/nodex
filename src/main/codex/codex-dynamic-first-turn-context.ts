import path from "node:path";
import type { CodexDynamicCreatePermissionContext } from "./codex-dynamic-create-permissions";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function appendUniqueRoots(current: readonly string[], additions: readonly string[]): string[] {
  const roots = [...current];
  for (const root of additions) {
    if (root && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

/** Exact `yve`/`UGe`: UUIDv7 timestamp → UTC visualization day directory. */
export function resolveCodexThreadVisualizationDirectory(
  codexHome: string,
  threadId: string,
): string | null {
  if (!UUID_V7_PATTERN.test(threadId)) return null;
  const timestamp = Number.parseInt(`${threadId.slice(0, 8)}${threadId.slice(9, 13)}`, 16);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return path.join(
    codexHome,
    "visualizations",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    threadId,
  );
}

/** Exact `X1`: retain known roots and grant the per-thread visualization root. */
export function augmentCodexDynamicFirstTurnPermissionContext(input: {
  readonly context: CodexDynamicCreatePermissionContext;
  readonly cwd: string;
  readonly retainedWritableRoots: readonly string[];
  readonly visualizationDirectory: string | null;
}): CodexDynamicCreatePermissionContext {
  const additions = [
    ...input.retainedWritableRoots,
    input.cwd,
    ...(input.visualizationDirectory ? [input.visualizationDirectory] : []),
  ];
  const sandboxPolicy = input.context.sandboxPolicy.type === "workspaceWrite"
    ? {
        ...input.context.sandboxPolicy,
        writableRoots: appendUniqueRoots(
          input.context.sandboxPolicy.writableRoots,
          additions,
        ),
      }
    : { ...input.context.sandboxPolicy };
  const runtimeWorkspaceRoots = input.context.activePermissionProfile === null
    ? input.context.runtimeWorkspaceRoots
    : appendUniqueRoots(
        input.context.runtimeWorkspaceRoots
          ?? (input.context.sandboxPolicy.type === "workspaceWrite"
            ? input.context.sandboxPolicy.writableRoots
            : []),
        additions,
      );

  return {
    ...input.context,
    ...(runtimeWorkspaceRoots === undefined ? {} : { runtimeWorkspaceRoots }),
    sandboxPolicy,
  };
}
