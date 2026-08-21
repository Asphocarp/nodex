import path from "node:path";
import type { CodexDynamicCreatePermissionContext } from "./codex-dynamic-create-permissions";
import { readCodexThreadUuidV7TimestampMs } from "./codex-thread-timestamps";

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
  const timestamp = readCodexThreadUuidV7TimestampMs(threadId);
  if (timestamp === null) return null;
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
  const sandboxPolicy =
    input.context.sandboxPolicy.type === "workspaceWrite"
      ? {
          ...input.context.sandboxPolicy,
          writableRoots: appendUniqueRoots(input.context.sandboxPolicy.writableRoots, additions),
        }
      : { ...input.context.sandboxPolicy };
  const runtimeWorkspaceRoots =
    input.context.activePermissionProfile === null
      ? input.context.runtimeWorkspaceRoots
      : appendUniqueRoots(
          input.context.runtimeWorkspaceRoots ??
            (input.context.sandboxPolicy.type === "workspaceWrite"
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
