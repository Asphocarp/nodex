import { toApiUrl } from "./http-base";
import { browserPendingWorktreeFallback } from "./browser-pending-worktree-fallback";
import {
  applyCommandKeybindingUpdate,
  createCommandKeymapState,
  type CommandKeybindingOverrides,
  type CommandKeybindingUpdate,
  type CommandKeymapState,
} from "../../shared/command-keybindings";
import { createDefaultWorkbenchLayoutSnapshot } from "../../shared/workbench-layout";
import type {
  AppUpdateStatus,
  ProjectSessionTabDeleteInput,
  WindowSessionBootstrap,
  WorkbenchLayoutSnapshot,
} from "./types";
import { parseProductFeatureGates } from "../../shared/product-feature-gates";
import {
  parseProjectLifecycleMutationResult,
  ProjectLifecycleMutationResultSchema,
} from "../../shared/schemas/projects";
import type {
  BoardChangeEvent,
  ProjectSessionsChangeEvent,
  ProjectsChangeEvent,
} from "../../shared/ipc-api";
import type {
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../../shared/types";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type {
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import {
  createHttpDocumentSyncAdapter,
  createHttpLibraryDocumentSyncAdapter,
} from "./http-document-sync-adapter";
import { createHttpCanvasSceneSyncAdapter } from "./http-canvas-scene-sync-adapter";
import {
  decodeDocumentHttpError,
  decodeLibraryOwnedDocumentDescriptorHttp,
  decodeOwnedDocumentDescriptorHttp,
} from "../../shared/block-documents/http-contract";
import {
  decodePageOwnershipPathReadModelHttp,
  decodePageTargetReadModelHttp,
  decodeDatabaseViewReadModelHttp,
} from "../../shared/reference-read-http-contract";
import {
  parseBlockPropertyMutationCommandResultV2,
  parseLibraryBlockPropertyMutationCommandResultV2,
} from "../../shared/block-property-mutations-v2";
import {
  parseLibraryPageDetailResult,
  parsePageDetailResult,
} from "../../shared/page-detail";
import {
  parseDatabaseApplyResultV2,
  parseDatabaseModuleReadResultV2,
  parseLibraryDatabaseApplyResultV2,
  parseLibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2-transport";
import {
  parseLibraryModuleApplyResult,
  parseLibraryModuleReadResult,
} from "../../shared/library-module-transport";
import {
  parseDocumentOperationCommandResult,
  type DocumentMutationRequest,
  type DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import {
  parseAdditionalDocumentCommandResult,
  type AdditionalDocumentCommandResult,
} from "../../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../../shared/additional-document-command-transport";
import type { BlockTransferCommandResult } from "../../shared/block-transfer";
import {
  decodeBlockTransferHttpResult,
  type PublicBlockTransferIntent,
} from "../../shared/block-transfer-transport";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
  PrepareDocumentVersionRestore,
} from "../../shared/block-documents/document-history";
import type { DocumentHistoryCommandResult } from "../../shared/block-documents/document-history-transport";
import {
  parsePageLifecycleMutationCommandResultV2,
  type PageLifecycleMutationCommandResultV2,
  type PageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import type { PageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-runtime";
import { parsePageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-transport";
import type { ListPageHistoryRequest } from "../../shared/page-history";
import {
  parsePageHistoryCommandResult,
  type PageHistoryCommandResult,
} from "../../shared/page-history-transport";

const decodeDocumentHistoryResponse = <T>(
  value: unknown,
): DocumentHistoryCommandResult<T> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Document history response must be an object");
  }
  const result = value as Readonly<Record<string, unknown>>;
  if (result.ok === true && Object.hasOwn(result, "value")) {
    return { ok: true, value: result.value as T };
  }
  if (
    result.ok === false &&
    typeof result.error === "object" &&
    result.error !== null &&
    !Array.isArray(result.error)
  ) {
    return value as DocumentHistoryCommandResult<T>;
  }
  throw new Error("Document history response has an invalid result envelope");
};

function isStorybookRuntime(): boolean {
  return typeof window !== "undefined" && window.__NODEX_STORYBOOK__ === true;
}

function resolveUnsupportedAppUpdateStatus(): AppUpdateStatus {
  return {
    status: "unsupported",
    supported: false,
    currentVersion: "dev",
    availableVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    progressPercent: null,
    transferredBytes: null,
    totalBytes: null,
    checkedAt: null,
    message: "App updates are only available in packaged macOS builds.",
  };
}

let browserWindowSessionLayout = createDefaultWorkbenchLayoutSnapshot();
let browserCommandKeybindingOverrides: CommandKeybindingOverrides = {};
let browserCodexPersonality: import("../../shared/types").CodexPersonality = "friendly";

function createBrowserWindowSessionBootstrap(
  layout: WorkbenchLayoutSnapshot,
): WindowSessionBootstrap {
  const timestamp = new Date().toISOString();
  return {
    session: {
      id: "browser-window-session",
      layout,
      createdAt: timestamp,
      updatedAt: timestamp,
      focusedAt: timestamp,
    },
  };
}

interface StoryGitReviewFile {
  path: string;
  previousPath: string | null;
  status:
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "copied"
    | "type-changed"
    | "unmerged"
    | "untracked";
  additions: number;
  deletions: number;
  rawStatus?: string | null;
  oldOid?: string | null;
  newOid?: string | null;
  revision?: string | null;
}

interface StoryGitReviewSnapshot {
  cwd: string;
  source: "unstaged" | "staged" | "branch";
  patch: string;
  files: StoryGitReviewFile[];
  isGitRepository: boolean;
  baseRef: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
}

const browserGitReviewLiveQuerySubscribers = new Set<
  (event: import("../../shared/types").GitReviewLiveEvent) => void
>();
const browserGitReviewSubscriptions = new Map<
  string,
  import("../../shared/types").GitReviewLiveQuery
>();

function publishBrowserGitReviewLiveQuery(
  event: import("../../shared/types").GitReviewLiveEvent,
): void {
  for (const subscriber of browserGitReviewLiveQuerySubscribers) {
    subscriber(event);
  }
}

async function readBrowserGitReviewLiveQuery(
  query: import("../../shared/types").GitReviewLiveQuery,
): Promise<import("../../shared/types").GitReviewLiveQueryResult> {
  switch (query.method) {
    case "review-summary":
      return {
        method: query.method,
        result: await invoke("git:review:summary", query.params),
      } as import("../../shared/types").GitReviewLiveQueryResult;
    case "branch-diff-stats":
      return {
        method: query.method,
        result: await invoke("git:review:branch-diff-stats", query.params),
      } as import("../../shared/types").GitReviewLiveQueryResult;
    case "branch-commits":
      return {
        method: query.method,
        result: await invoke("git:review:branch-commits", query.params),
      } as import("../../shared/types").GitReviewLiveQueryResult;
    case "base-branch":
      {
        const metadata = await invoke(
          "git:review:repository-metadata",
          query.params,
        ) as import("../../shared/types").GitReviewRepositoryMetadataResult;
        return {
          method: query.method,
          result: {
            cwd: metadata.cwd,
            local: metadata.defaultBranch,
            remote: null,
            errorMessage: metadata.errorMessage,
          },
        } as import("../../shared/types").GitReviewLiveQueryResult;
      }
  }
}

function splitStoryPatchFileDiffs(patch: string): string[] {
  const matches = Array.from(patch.matchAll(/^diff --git .+$/gm));
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? patch.length;
    return patch.slice(start, end).trimEnd();
  });
}

function buildStoryFileFromDiff(
  diff: string,
  index: number,
): StoryGitReviewFile {
  const header = diff.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  const path = header?.[2] ?? `src/file-${index + 1}.ts`;
  const previousPath = header?.[1] && header[1] !== path ? header[1] : null;
  const additions = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deletions = diff
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const status = diff.includes("--- /dev/null")
    ? "added"
    : diff.includes("+++ /dev/null")
      ? "deleted"
      : previousPath
        ? "renamed"
        : "modified";

  return {
    path,
    previousPath,
    status,
    rawStatus: null,
    oldOid: null,
    newOid: null,
    revision: `story:${status}:${path}:${additions}:${deletions}`,
    additions,
    deletions,
  };
}

function toStoryReviewDiffResult(snapshot: StoryGitReviewSnapshot) {
  const fileDiffs = splitStoryPatchFileDiffs(snapshot.patch);
  const files = (
    snapshot.files.length > 0
      ? snapshot.files
      : fileDiffs.map(buildStoryFileFromDiff)
  ).map((file, index) => {
    const diff = fileDiffs[index] ?? "";
    return {
      ...file,
      diff,
      loadStatus: "loaded" as const,
      renderKey: `${file.previousPath ?? ""}->${file.path}:${file.additions}:${file.deletions}:${diff.length}`,
      diffBytes: diff.length,
      diffError: null,
      canApplyPatchActions: diff.trim().length > 0,
      changedBytes: diff.length,
      tooLarge: file.additions + file.deletions > 15_000,
      tooLargeReason: null,
    };
  });

  return {
    type: "success" as const,
    ...snapshot,
    snapshotGeneration: 1,
    patch: files
      .map((file) => file.diff)
      .filter(Boolean)
      .join("\n"),
    files,
  };
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  switch (channel) {
    case "codex:personality:get":
      return browserCodexPersonality;
    case "codex:personality:set":
      if (args[0] !== "none" && args[0] !== "friendly" && args[0] !== "pragmatic") {
        throw new Error(`Unsupported Codex personality: ${String(args[0])}`);
      }
      browserCodexPersonality = args[0];
      return undefined;
    case "codex:pending-worktrees:list":
      return browserPendingWorktreeFallback.list();
    case "codex:pending-worktree:create":
      return browserPendingWorktreeFallback.create(
        args[0] as import("../../shared/codex-pending-worktree").CodexPendingWorktreeCreateInput,
      );
    case "codex:pending-worktree:resolve-thread":
      return browserPendingWorktreeFallback.resolveThread(String(args[0] ?? ""));
    case "codex:pending-worktree:retry":
      browserPendingWorktreeFallback.retry(String(args[1] ?? ""));
      return undefined;
    case "codex:pending-worktree:continue":
      browserPendingWorktreeFallback.continueWithoutSetup(String(args[1] ?? ""));
      return undefined;
    case "codex:pending-worktree:cancel":
      browserPendingWorktreeFallback.cancel(String(args[1] ?? ""));
      return undefined;
    case "codex:pending-worktree:dismiss":
      browserPendingWorktreeFallback.dismiss(String(args[1] ?? ""));
      return undefined;
    case "codex:pending-worktree:rename":
      browserPendingWorktreeFallback.rename(
        String(args[1] ?? ""),
        String(args[2] ?? ""),
      );
      return undefined;
    case "codex:pending-worktree:set-pinned":
      browserPendingWorktreeFallback.setPinned(
        String(args[1] ?? ""),
        args[2] === true,
      );
      return undefined;
    case "codex:pending-worktree:set-pinned-before-thread":
      browserPendingWorktreeFallback.setPinnedBeforeThreadId(
        String(args[1] ?? ""),
        typeof args[2] === "string" ? args[2] : null,
      );
      return undefined;
    case "codex:pending-worktree:clear-attention":
      browserPendingWorktreeFallback.clearAttention(String(args[1] ?? ""));
      return undefined;
    case "codex:pending-worktree:work-locally":
      browserPendingWorktreeFallback.cancel(String(args[1] ?? ""));
      throw new Error("Starting a Codex thread is unavailable in the browser renderer");
    case "codex:pending-worktree:auto-fix":
      throw new Error("Pending worktree Auto-fix is unavailable in the browser renderer");
    case "codex:pending-worktree:discard-fork-side-panel-transfer":
      return undefined;
    case "projects:list": {
      const [options] = args as [{ includeArchived?: boolean }?];
      const query = options?.includeArchived === true ? "?includeArchived=true" : "";
      const res = await fetch(toApiUrl(`/api/projects${query}`));
      const data = await res.json();
      return data.projects;
    }
    case "projects:create": {
      const [input] = args as [
        {
          name?: string;
          description?: string;
          icon?: string;
          sources?: string[];
        },
      ];
      const res = await fetch(toApiUrl("/api/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    }
    case "projects:set-lifecycle": {
      const [projectId, input] = args as [
        string,
        { lifecycle: "active" | "archived" },
      ];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/lifecycle`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result: unknown = await res.json();
      if (!res.ok) {
        if (res.status === 404 || res.status === 409) {
          const parsed = ProjectLifecycleMutationResultSchema.safeParse(result);
          if (parsed.success) return parsed.data;
        }
        throw new Error(
          typeof result === "object"
            && result !== null
            && "error" in result
            && typeof result.error === "string"
            ? result.error
            : `Project lifecycle request failed with ${res.status}`,
        );
      }
      return parseProjectLifecycleMutationResult(result);
    }
    case "projects:update": {
      const [projectId, updates] = args as [
        string,
        {
          name?: string;
          description?: string;
          icon?: string;
          sources?: string[];
        },
      ];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      return res.json();
    }
    case "projects:reorder": {
      const [input] = args as [{ orderedProjectIds: string[] }];
      const res = await fetch(toApiUrl("/api/projects/order"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      return data.projects ?? [];
    }
    case "projects:set-pinned": {
      const [projectId, input] = args as [string, { pinned: boolean }];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/pinned`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.ok ? res.json() : null;
    }
    case "projects:set-pinned-order": {
      const [input] = args as [{ orderedProjectIds: string[] }];
      const res = await fetch(toApiUrl("/api/projects/pinned-order"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      return data.projects ?? [];
    }
    case "project-sessions:list": {
      const [projectId, options] = args as [
        string,
        { includeArchived?: boolean }?,
      ];
      const params = new URLSearchParams();
      if (options?.includeArchived === true) {
        params.set("includeArchived", "true");
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/sessions${suffix}`),
      );
      const data = await res.json();
      return data.sessions ?? [];
    }
    case "project-sessions:list-summaries": {
      const [projectId, options] = args as [
        string,
        { includeArchived?: boolean }?,
      ];
      const params = new URLSearchParams();
      if (options?.includeArchived === true) {
        params.set("includeArchived", "true");
      }
      params.set("summary", "true");
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/sessions${suffix}`),
      );
      const data = await res.json();
      return data.sessions ?? [];
    }
    case "project-sessions:get": {
      const [sessionId] = args as [string];
      const res = await fetch(toApiUrl(`/api/project-sessions/${sessionId}`));
      return res.ok ? res.json() : null;
    }
    case "project-sessions:create": {
      const [input] = args as [{ projectId: string; title: string }];
      const res = await fetch(
        toApiUrl(`/api/projects/${input.projectId}/sessions`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.json();
    }
    case "project-sessions:update": {
      const [sessionId, input] = args as [string, object];
      const res = await fetch(toApiUrl(`/api/project-sessions/${sessionId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.ok ? res.json() : null;
    }
    case "project-sessions:rename": {
      const [sessionId, input] = args as [string, object];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/rename`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-sessions:delete": {
      const [sessionId] = args as [string];
      const res = await fetch(toApiUrl(`/api/project-sessions/${sessionId}`), {
        method: "DELETE",
      });
      const data = await res.json();
      return data.success ?? false;
    }
    case "project-sessions:reorder": {
      const [projectId, orderedSessionIds] = args as [string, string[]];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/sessions/reorder`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedSessionIds }),
        },
      );
      const data = await res.json();
      return data.sessions ?? [];
    }
    case "project-sessions:set-pinned": {
      const [sessionId, input] = args as [string, { pinned: boolean }];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/pinned`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-sessions:set-pinned-order": {
      const [projectId, input] = args as [
        string,
        { orderedSessionIds: string[] },
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/sessions/pinned-order`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const data = await res.json();
      return data.sessions ?? [];
    }
    case "project-sessions:archive": {
      const [sessionId] = args as [string];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/archive`),
        {
          method: "PUT",
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-sessions:unarchive": {
      const [sessionId] = args as [string];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/unarchive`),
        {
          method: "PUT",
        },
      );
      return res.ok ? res.json() : null;
    }
    case "codex:thread:archive": {
      const [threadId] = args as [string];
      const res = await fetch(
        toApiUrl(`/api/codex/threads/${encodeURIComponent(threadId)}/archive`),
        {
          method: "PUT",
        },
      );
      if (!res.ok) return false;
      const data = await res.json();
      return data.success === true;
    }
    case "codex:thread:unarchive": {
      const [threadId] = args as [string];
      const res = await fetch(
        toApiUrl(
          `/api/codex/threads/${encodeURIComponent(threadId)}/unarchive`,
        ),
        {
          method: "PUT",
        },
      );
      return res.ok ? res.json() : null;
    }
    case "codex:sidebar:thread:move": {
      const [input] = args as [object];
      const res = await fetch(toApiUrl("/api/codex/sidebar/thread-move"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(
          typeof error.error === "string"
            ? error.error
            : "Couldn’t move task",
        );
      }
      return res.json();
    }
    case "codex:sidebar:project-thread-order:set": {
      const [input] = args as [object];
      const res = await fetch(
        toApiUrl("/api/codex/sidebar/project-thread-order"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(
          typeof error.error === "string"
            ? error.error
            : "Failed to reorder project tasks",
        );
      }
      return res.json();
    }
    case "codex:sidebar:chats-thread-order:set": {
      const [input] = args as [object];
      const res = await fetch(
        toApiUrl("/api/codex/sidebar/chats-thread-order"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(
          typeof error.error === "string"
            ? error.error
            : "Failed to reorder Chats tasks",
        );
      }
      return res.json();
    }
    case "project-sessions:mark-unread": {
      const [sessionId, input] = args as [string, { unread: boolean }];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/unread`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-sessions:fork": {
      const [sessionId, input] = args as [string, object];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/fork`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(
          typeof error.error === "string"
            ? error.error
            : "Failed to fork session",
        );
      }
      return res.json();
    }
    case "project-session-tabs:create": {
      const [input] = args as [{ sessionId: string }];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${input.sessionId}/tabs`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.json();
    }
    case "project-session-tabs:update": {
      const [tabId, input] = args as [string, object];
      const res = await fetch(toApiUrl(`/api/project-session-tabs/${tabId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:update": {
      const [sessionId, panelId, input] = args as [string, string, object];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/panels/${panelId}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:split": {
      const [input] = args as [{ sessionId: string; panelId: string }];
      const res = await fetch(
        toApiUrl(
          `/api/project-sessions/${input.sessionId}/panels/${input.panelId}/split`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:ensure-right-leaf": {
      const [input] = args as [{ sessionId: string; panelId: string }];
      const res = await fetch(
        toApiUrl(
          `/api/project-sessions/${input.sessionId}/panels/${input.panelId}/ensure-right-leaf`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:merge": {
      const [input] = args as [{ sessionId: string; panelId: string }];
      const res = await fetch(
        toApiUrl(
          `/api/project-sessions/${input.sessionId}/panels/${input.panelId}/merge`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:activate": {
      const [input] = args as [{ sessionId: string; panelId: string }];
      const res = await fetch(
        toApiUrl(
          `/api/project-sessions/${input.sessionId}/panels/${input.panelId}/active-group`,
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:resize": {
      const [input] = args as [{ sessionId: string; panelId: string }];
      const res = await fetch(
        toApiUrl(
          `/api/project-sessions/${input.sessionId}/panels/${input.panelId}/resize-group`,
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-panels:maximize": {
      const [input] = args as [{ sessionId: string; panelId: string }];
      const res = await fetch(
        toApiUrl(
          `/api/project-sessions/${input.sessionId}/panels/${input.panelId}/maximized-group`,
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-tabs:state:update": {
      const [tabId, stateKey, state] = args as [string, number, unknown];
      const res = await fetch(
        toApiUrl(`/api/project-session-tabs/${tabId}/state`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stateKey, state }),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-tabs:delete": {
      const [input] = args as [string | ProjectSessionTabDeleteInput];
      const tabId = typeof input === "string" ? input : input.tabId;
      const deleteBody: Partial<ProjectSessionTabDeleteInput> = {};
      if (typeof input !== "string") {
        if (
          input.preserveEmptyLeafIds &&
          input.preserveEmptyLeafIds.length > 0
        ) {
          deleteBody.preserveEmptyLeafIds = input.preserveEmptyLeafIds;
        }
        if (input.preferredActiveLeafId !== undefined) {
          deleteBody.preferredActiveLeafId = input.preferredActiveLeafId;
        }
        if (input.preferredActiveTabId !== undefined) {
          deleteBody.preferredActiveTabId = input.preferredActiveTabId;
        }
      }
      const hasDeleteBody = Object.keys(deleteBody).length > 0;
      const res = await fetch(toApiUrl(`/api/project-session-tabs/${tabId}`), {
        method: "DELETE",
        ...(hasDeleteBody
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(deleteBody),
            }
          : {}),
      });
      const data = await res.json();
      return data.success ?? false;
    }
    case "project-session-tabs:reorder": {
      const [input] = args as [
        {
          sessionId: string;
          panelId: string;
          leafId?: string;
          orderedTabIds: string[];
        },
      ];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${input.sessionId}/tabs/reorder`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            panelId: input.panelId,
            leafId: input.leafId,
            orderedTabIds: input.orderedTabIds,
          }),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-tabs:move": {
      const [input] = args as [
        {
          tabId: string;
          targetPanelId: string;
          targetLeafId?: string;
          targetIndex?: number;
          preserveEmptyLeafIds?: string[];
          splitTarget?: object;
        },
      ];
      const res = await fetch(
        toApiUrl(`/api/project-session-tabs/${input.tabId}/move`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.ok ? res.json() : null;
    }
    case "project-session-threads:attach": {
      const [input] = args as [{ sessionId: string }];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${input.sessionId}/thread`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return res.json();
    }
    case "project-session-threads:detach": {
      const [sessionId] = args as [string];
      const res = await fetch(
        toApiUrl(`/api/project-sessions/${sessionId}/thread`),
        { method: "DELETE" },
      );
      const data = await res.json();
      return data.success ?? false;
    }
    case "board:summary:get": {
      const [projectId] = args as [string];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/board-summary`),
      );
      return res.json();
    }
    case "block-properties:mutate": {
      const [projectId, request] = args as [string, unknown];
      const response = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/block-property-mutations`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parseBlockPropertyMutationCommandResultV2(await response.json());
    }
    case "pages:detail:get": {
      const [projectId, pageId] = args as [string, string];
      const response = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}`,
        ),
        { headers: { Accept: "application/json" } },
      );
      return parsePageDetailResult(await response.json());
    }
    case "pages:lifecycle:preflight": {
      const [projectId, pageId] = args as [string, string];
      const response = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/page-lifecycle-preflight?pageId=${encodeURIComponent(pageId)}`,
        ),
        { headers: { Accept: "application/json" } },
      );
      return parsePageLifecyclePreflightResultV2(await response.json());
    }
    case "pages:lifecycle:apply": {
      const [projectId, request] = args as [
        string,
        PageLifecycleMutationRequestV2,
      ];
      const response = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/page-lifecycle-mutations`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parsePageLifecycleMutationCommandResultV2(await response.json());
    }
    case "database-module:read": {
      const [projectId, request] = args as [string, unknown];
      const response = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/database-module/read`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parseDatabaseModuleReadResultV2(await response.json());
    }
    case "database-module:apply": {
      const [projectId, request] = args as [string, unknown];
      const response = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/database-module/apply`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parseDatabaseApplyResultV2(await response.json());
    }
    case "library-module:read": {
      const [request] = args as [unknown];
      const response = await fetch(toApiUrl("/api/library-module/read"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
      });
      return parseLibraryModuleReadResult(await response.json());
    }
    case "library-module:apply": {
      const [request] = args as [unknown];
      const response = await fetch(toApiUrl("/api/library-module/apply"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
      });
      return parseLibraryModuleApplyResult(await response.json());
    }
    case "library-database-module:read": {
      const [request] = args as [unknown];
      const response = await fetch(
        toApiUrl("/api/library/database-module/read"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parseLibraryDatabaseModuleReadResultV2(await response.json());
    }
    case "library-database-module:apply": {
      const [request] = args as [unknown];
      const response = await fetch(
        toApiUrl("/api/library/database-module/apply"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parseLibraryDatabaseApplyResultV2(await response.json());
    }
    case "library-pages:detail:get": {
      const [pageId] = args as [string];
      const response = await fetch(
        toApiUrl(`/api/library/pages/${encodeURIComponent(pageId)}`),
        { headers: { Accept: "application/json" } },
      );
      return parseLibraryPageDetailResult(await response.json());
    }
    case "library-block-properties:mutate": {
      const [request] = args as [unknown];
      const response = await fetch(
        toApiUrl("/api/library/block-property-mutations"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
        },
      );
      return parseLibraryBlockPropertyMutationCommandResultV2(
        await response.json(),
      );
    }
    case "page-target:resolve": {
      const [input] = args as [
        {
          requestingProjectId: string;
          targetPageId: string;
        },
      ];
      const res = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(input.requestingProjectId)}` +
            `/page-targets/${encodeURIComponent(input.targetPageId)}`,
        ),
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `Page target lookup failed with status ${res.status}`,
        );
      }
      return decodePageTargetReadModelHttp(await res.json());
    }
    case "page-ownership-path:resolve": {
      const [input] = args as [
        {
          requestingProjectId: string;
          targetPageId: string;
        },
      ];
      const res = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(input.requestingProjectId)}` +
            `/page-targets/${encodeURIComponent(input.targetPageId)}/ownership-path`,
        ),
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `Page ownership path lookup failed with status ${res.status}`,
        );
      }
      return decodePageOwnershipPathReadModelHttp(await res.json());
    }
    case "database-view:reference:get": {
      const [input] = args as [
        {
          requestingProjectId: string;
          databaseViewId: string;
          hostBlockId?: string;
        },
      ];
      const hostQuery = input.hostBlockId
        ? `?hostBlockId=${encodeURIComponent(input.hostBlockId)}`
        : "";
      const res = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(input.requestingProjectId)}` +
            `/references/database-views/${encodeURIComponent(input.databaseViewId)}` +
            hostQuery,
        ),
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `Database View lookup failed with status ${res.status}`,
        );
      }
      return decodeDatabaseViewReadModelHttp(await res.json());
    }
    case "database-rows:details:get": {
      const [projectId, input] = args as [string, { pageIds: string[] }];
      const res = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/database-rows/details`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) return [];
      return res.json();
    }
    case "pages:search": {
      const [input] = args as [
        { projectIds: string[]; query: string; limit?: number },
      ];
      const res = await fetch(toApiUrl("/api/pages/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return [];
      return res.json();
    }
    case "database-row:get": {
      const [projectId, pageId, status] = args as [string, string, string?];
      const params = new URLSearchParams({ pageId });
      if (status) params.set("status", status);
      const res = await fetch(
        toApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/database-row?${params.toString()}`,
        ),
      );
      if (!res.ok) return null;
      return res.json();
    }
    case "window-sessions:bootstrap": {
      return createBrowserWindowSessionBootstrap(browserWindowSessionLayout);
    }
    case "app:feature-gates:get": {
      const response = await fetch(toApiUrl("/api/app/feature-gates"), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Feature gates request failed with ${response.status}`);
      }
      return parseProductFeatureGates(await response.json());
    }
    case "window-sessions:save-layout": {
      const [layout] = args as [WorkbenchLayoutSnapshot];
      browserWindowSessionLayout = layout;
      return createBrowserWindowSessionBootstrap(browserWindowSessionLayout);
    }
    case "window-sessions:update-bounds": {
      return undefined;
    }
    case "calendar:occurrences": {
      const [projectId, windowStart, windowEnd, searchQuery] = args as [
        string,
        Date,
        Date,
        string?,
      ];
      const params = new URLSearchParams({
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      });
      if (searchQuery && searchQuery.trim().length > 0)
        params.set("search", searchQuery);
      const res = await fetch(
        toApiUrl(
          `/api/projects/${projectId}/calendar/occurrences?${params.toString()}`,
        ),
      );
      return res.json();
    }
    case "page:occurrence:complete": {
      const [projectId, input, sessionId] = args as [
        string,
        PageOccurrenceCompleteInput,
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/page-occurrence/complete`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            occurrenceStart: input.occurrenceStart.toISOString(),
            sessionId,
          }),
        },
      );
      return res.json();
    }
    case "page:occurrence:skip": {
      const [projectId, input, sessionId] = args as [
        string,
        PageOccurrenceActionInput,
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/page-occurrence/skip`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            occurrenceStart: input.occurrenceStart.toISOString(),
            sessionId,
          }),
        },
      );
      return res.json();
    }
    case "page:occurrence:update": {
      const [projectId, input, sessionId] = args as [
        string,
        PageOccurrenceUpdateInput,
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/page-occurrence`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            occurrenceStart: input.occurrenceStart.toISOString(),
            sessionId,
          }),
        },
      );
      return res.json();
    }
    case "backup:list": {
      const res = await fetch(toApiUrl("/api/backups"));
      const data = await res.json();
      return data.backups;
    }
    case "backup:create": {
      const [input] = args as [{ label?: string }?];
      const res = await fetch(toApiUrl("/api/backups"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        const message =
          typeof error.error === "string"
            ? error.error
            : `Request failed: ${res.status}`;
        throw new Error(message);
      }
      return res.json();
    }
    case "backup:delete": {
      const [backupId] = args as [string];
      const res = await fetch(
        toApiUrl(`/api/backups/${encodeURIComponent(backupId)}`),
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        const message =
          typeof error.error === "string"
            ? error.error
            : `Request failed: ${res.status}`;
        throw new Error(message);
      }
      return res.json();
    }
    case "backup:restore": {
      const [input] = args as [
        { backupId: string; confirm: boolean; createSafetyBackup?: boolean },
      ];
      const res = await fetch(
        toApiUrl(`/api/backups/${encodeURIComponent(input.backupId)}/restore`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: input.confirm,
            createSafetyBackup: input.createSafetyBackup,
          }),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        const message =
          typeof error.error === "string"
            ? error.error
            : `Request failed: ${res.status}`;
        throw new Error(message);
      }
      return res.json();
    }
    case "settings:backup:get": {
      const res = await fetch(toApiUrl("/api/settings/backup"));
      return res.json();
    }
    case "settings:backup:update": {
      const [input] = args as [
        {
          autoEnabled: boolean;
          intervalHours: number;
          retentionCount: number;
        },
      ];
      const res = await fetch(toApiUrl("/api/settings/backup"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    }
    case "settings:history:get": {
      const res = await fetch(toApiUrl("/api/settings/history"));
      return res.json();
    }
    case "settings:history:update": {
      const [input] = args as [{ retentionCount: number }];
      const res = await fetch(toApiUrl("/api/settings/history"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    }
    case "settings:diagnostics:get": {
      return {
        enabled: false,
        dsn: "",
        environment: "browser",
        release: null,
        tracesSampleRate: 0,
        replayEnabled: false,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1,
        envOverrides: {
          enabled: false,
          dsn: false,
          environment: false,
          release: false,
          tracesSampleRate: false,
          replayEnabled: false,
          replaysSessionSampleRate: false,
          replaysOnErrorSampleRate: false,
        },
      };
    }
    case "settings:diagnostics:update": {
      const [input] = args as [
        {
          enabled?: boolean;
          dsn?: string;
          environment?: string;
          release?: string | null;
          tracesSampleRate?: number;
          replayEnabled?: boolean;
          replaysSessionSampleRate?: number;
          replaysOnErrorSampleRate?: number;
        },
      ];
      return {
        enabled: input.enabled === true,
        dsn: input.dsn ?? "",
        environment: input.environment ?? "browser",
        release: input.release ?? null,
        tracesSampleRate: input.tracesSampleRate ?? 0,
        replayEnabled: input.replayEnabled === true,
        replaysSessionSampleRate: input.replaysSessionSampleRate ?? 0.1,
        replaysOnErrorSampleRate: input.replaysOnErrorSampleRate ?? 1,
        envOverrides: {
          enabled: false,
          dsn: false,
          environment: false,
          release: false,
          tracesSampleRate: false,
          replayEnabled: false,
          replaysSessionSampleRate: false,
          replaysOnErrorSampleRate: false,
        },
      };
    }
    case "settings:telemetry:get": {
      return {
        enabled: false,
        clientKey: "",
        environment: "browser",
        autoCaptureEnabled: false,
        envOverrides: {
          enabled: false,
          clientKey: false,
          environment: false,
          autoCaptureEnabled: false,
        },
      };
    }
    case "settings:telemetry:update": {
      const [input] = args as [
        {
          enabled?: boolean;
          clientKey?: string;
          environment?: string;
          autoCaptureEnabled?: boolean;
        },
      ];
      return {
        enabled: input.enabled === true,
        clientKey: input.clientKey ?? "",
        environment: input.environment ?? "browser",
        autoCaptureEnabled: input.autoCaptureEnabled === true,
        envOverrides: {
          enabled: false,
          clientKey: false,
          environment: false,
          autoCaptureEnabled: false,
        },
      };
    }
    case "settings:thread-notifications:get": {
      const res = await fetch(toApiUrl("/api/settings/thread-notifications"));
      return res.json();
    }
    case "settings:thread-notifications:update": {
      const [input] = args as [
        {
          turnMode: "off" | "unfocused" | "always";
          permissionsEnabled: boolean;
          questionsEnabled: boolean;
        },
      ];
      const res = await fetch(toApiUrl("/api/settings/thread-notifications"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    }
    case "settings:app-updates:get": {
      return { automaticChecksEnabled: true };
    }
    case "settings:app-updates:update": {
      const [input] = args as [{ automaticChecksEnabled?: boolean }];
      return { automaticChecksEnabled: input.automaticChecksEnabled !== false };
    }
    case "settings:window-restore:get": {
      return { policy: "all" };
    }
    case "settings:window-restore:update": {
      const [input] = args as [{ policy?: string }];
      return {
        policy:
          input.policy === "last-window" || input.policy === "none"
            ? input.policy
            : "all",
      };
    }
    case "codex-command-keymap-state": {
      return createCommandKeymapState(browserCommandKeybindingOverrides);
    }
    case "set-codex-command-keybinding": {
      const [commandId, update] = args as [string, CommandKeybindingUpdate];
      browserCommandKeybindingOverrides = applyCommandKeybindingUpdate(
        browserCommandKeybindingOverrides,
        commandId,
        update,
      );
      return createCommandKeymapState(browserCommandKeybindingOverrides);
    }
    case "reset-codex-command-keybindings": {
      browserCommandKeybindingOverrides = {};
      return createCommandKeymapState(browserCommandKeybindingOverrides);
    }
    case "global-dictation-capture-fn-hotkey": {
      return null;
    }
    case "app:update:status":
    case "app:update:check": {
      return resolveUnsupportedAppUpdateStatus();
    }
    case "app:update:install": {
      return false;
    }
    case "git:branch:state": {
      if (isStorybookRuntime()) {
        return {
          currentBranch: "main",
          defaultBranch: "main",
          branches: ["main", "codex/storybook", "release/candidate"],
        };
      }
      const [cwd] = args as [string];
      const params = new URLSearchParams({ cwd });
      const res = await fetch(toApiUrl(`/api/git/branch?${params.toString()}`));
      return res.json();
    }
    case "git:branch:checkout": {
      if (isStorybookRuntime()) {
        return { success: true };
      }
      const [input] = args as [{ cwd: string; branch: string }];
      const res = await fetch(toApiUrl("/api/git/branch/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    }
    case "git:branch:create": {
      if (isStorybookRuntime()) {
        return { success: true };
      }
      const [input] = args as [{ cwd: string; branch: string }];
      const res = await fetch(toApiUrl("/api/git/branch/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    }
    case "git:review:repository-metadata": {
      const [input] = args as [{ cwd: string }];
      const isGitRepository = !input.cwd.includes("no-git");
      return {
        cwd: input.cwd,
        root: isGitRepository ? input.cwd : null,
        gitDir: isGitRepository ? `${input.cwd}/.git` : null,
        commonDir: isGitRepository ? `${input.cwd}/.git` : null,
        isGitRepository,
        currentBranch: isGitRepository ? "codex/storybook" : null,
        defaultBranch: isGitRepository ? "main" : null,
        errorMessage: null,
      };
    }
    case "git:review:summary": {
      const [input] = args as [
        {
          cwd: string;
          source: "unstaged" | "staged" | "branch" | "commit";
          baseRef?: string | null;
          baseBranch?: string | null;
        },
      ];
      const snapshot = (await invoke("git:review:snapshot", {
        cwd: input.cwd,
        source: input.source,
        baseRef: input.baseBranch ?? input.baseRef ?? null,
      })) as StoryGitReviewSnapshot;
      const diff = toStoryReviewDiffResult(snapshot);
      return {
        type: "success",
        source: input.source,
        files: diff.files,
        snapshotGeneration: 1,
        stageCounts: {
          stagedFileCount: input.source === "staged" ? diff.files.length : 0,
          unstagedFileCount:
            input.source === "unstaged" ? diff.files.length : 0,
          untrackedFileCount: 0,
        },
      };
    }
    case "git:live-query:subscribe": {
      const [input] = args as [
        import("../../shared/types").GitReviewLiveSubscriptionInput,
      ];
      browserGitReviewSubscriptions.set(input.subscriptionId, input.query);
      const publish = (
        phase: "tracked" | "complete",
        output: import("../../shared/types").GitReviewLiveQueryResult,
      ) => {
        publishBrowserGitReviewLiveQuery({
          type: "git-live-query-updated",
          subscriptionId: input.subscriptionId,
          generation: 1,
          requiresRecovery: false,
          phase,
          ...output,
        });
      };
      if (
        input.query.method === "review-summary"
        && (
          input.query.params.source === "unstaged"
          || input.query.params.source === "branch"
        )
      ) {
        const tracked = await readBrowserGitReviewLiveQuery({
          ...input.query,
          params: {
            ...input.query.params,
            includeUntrackedFiles: false,
          },
        });
        if (
          tracked.method === "review-summary"
          && tracked.result.type === "success"
          && tracked.result.files.length > 0
        ) {
          publish("tracked", tracked);
        }
      }
      if (
        input.query.method === "branch-diff-stats"
        && input.query.params.includeUntrackedFiles === true
      ) {
        publish("tracked", await readBrowserGitReviewLiveQuery({
          ...input.query,
          params: {
            ...input.query.params,
            includeUntrackedFiles: false,
          },
        }));
      }
      const output = await readBrowserGitReviewLiveQuery(input.query);
      publish("complete", output);
      return undefined;
    }
    case "git:live-query:unsubscribe": {
      const [input] = args as [{ subscriptionId: string }];
      browserGitReviewSubscriptions.delete(input.subscriptionId);
      return undefined;
    }
    case "git:live-query:recover":
    case "git:live-query:refresh-repository": {
      const [input] = args as [{ subscriptionId: string }];
      const query = browserGitReviewSubscriptions.get(input.subscriptionId);
      if (!query) return undefined;
      const output = await readBrowserGitReviewLiveQuery(query);
      publishBrowserGitReviewLiveQuery({
        type: "git-live-query-updated",
        subscriptionId: input.subscriptionId,
        generation: Date.now(),
        requiresRecovery: false,
        phase: "complete",
        ...output,
      });
      return undefined;
    }
    case "git:review:snapshot": {
      const [input] = args as [
        {
          cwd: string;
          source: "unstaged" | "staged" | "branch";
          baseRef?: string | null;
        },
      ];
      if (isStorybookRuntime()) {
        const buildStorybookMultiFilePatch = (
          fileCount: number,
          nested = false,
        ): string => {
          return Array.from({ length: fileCount }, (_, index) => {
            const suffix = String(index + 1).padStart(3, "0");
            const dirPrefix = nested
              ? `src/domain-${String((index % 12) + 1).padStart(2, "0")}/feature-${String(Math.floor(index / 12) + 1).padStart(2, "0")}`
              : "src";
            const filePath = `${dirPrefix}/file-${suffix}.ts`;
            return [
              `diff --git a/${filePath} b/${filePath}`,
              "index 1111111..2222222 100644",
              `--- a/${filePath}`,
              `+++ b/${filePath}`,
              "@@ -1 +1,2 @@",
              ` export const file${suffix} = ${index + 1};`,
              `+export const changed${suffix} = true;`,
              "",
            ].join("\n");
          }).join("\n");
        };
        const buildStorybookGitReviewFiles = (
          fileCount: number,
          nested = false,
        ) => {
          return Array.from({ length: fileCount }, (_, index) => {
            const suffix = String(index + 1).padStart(3, "0");
            const dirPrefix = nested
              ? `src/domain-${String((index % 12) + 1).padStart(2, "0")}/feature-${String(Math.floor(index / 12) + 1).padStart(2, "0")}`
              : "src";
            const filePath = `${dirPrefix}/file-${suffix}.ts`;
            const status =
              index % 3 === 0
                ? "added"
                : index % 3 === 1
                  ? "modified"
                  : "deleted";
            return {
              path: filePath,
              previousPath: null,
              status,
              additions: status === "deleted" ? 0 : 1,
              deletions: status === "deleted" ? 1 : 0,
            };
          });
        };
        if (input.cwd.includes("no-git")) {
          return {
            cwd: input.cwd,
            source: input.source,
            patch: "",
            files: [],
            isGitRepository: false,
            baseRef: null,
            currentBranch: null,
            defaultBranch: null,
            errorMessage: null,
          };
        }
        if (input.cwd.includes("no-diff")) {
          return {
            cwd: input.cwd,
            source: input.source,
            patch: "",
            files: [],
            isGitRepository: true,
            baseRef:
              input.source === "branch" ? (input.baseRef ?? "main") : null,
            currentBranch: "codex/storybook",
            defaultBranch: "main",
            errorMessage: null,
          };
        }
        if (input.cwd.includes("staged-empty") && input.source === "staged") {
          return {
            cwd: input.cwd,
            source: input.source,
            patch: "",
            files: [],
            isGitRepository: true,
            baseRef: null,
            currentBranch: "codex/storybook",
            defaultBranch: "main",
            errorMessage: null,
          };
        }
        if (input.cwd.includes("large-diff")) {
          const addedLines = Array.from(
            { length: 9_105 },
            (_, index) => `+line ${index + 1}`,
          ).join("\n");
          return {
            cwd: input.cwd,
            source: input.source,
            patch: `diff --git a/src/large.ts b/src/large.ts\nindex 1111111..2222222 100644\n--- a/src/large.ts\n+++ b/src/large.ts\n@@ -1 +1,9106 @@\n export const large = true;\n${addedLines}\n`,
            files: [],
            isGitRepository: true,
            baseRef:
              input.source === "branch" ? (input.baseRef ?? "main") : null,
            currentBranch: "codex/storybook",
            defaultBranch: "main",
            errorMessage: null,
          };
        }
        if (input.cwd.includes("virtualized-tree")) {
          return {
            cwd: input.cwd,
            source: input.source,
            patch: buildStorybookMultiFilePatch(120, true),
            files: buildStorybookGitReviewFiles(120, true),
            isGitRepository: true,
            baseRef:
              input.source === "branch" ? (input.baseRef ?? "main") : null,
            currentBranch: "codex/storybook",
            defaultBranch: "main",
            errorMessage: null,
          };
        }
        const patch =
          input.source === "staged"
            ? "diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n export const title = 'Nodex';\n+export const staged = true;\n export const version = '1.0.0';\n"
            : input.source === "branch"
              ? "diff --git a/src/feature.ts b/src/feature.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/feature.ts\n@@ -0,0 +1,4 @@\n+export function reviewPanel() {\n+  return 'branch diff';\n+}\n+\n"
              : "diff --git a/src/workbench.tsx b/src/workbench.tsx\nindex 3333333..4444444 100644\n--- a/src/workbench.tsx\n+++ b/src/workbench.tsx\n@@ -10,2 +10,4 @@\n export function Workbench() {\n+  const showDiffTree = true;\n   return null;\n }\n";
        return {
          cwd: input.cwd,
          source: input.source,
          patch,
          files: [],
          isGitRepository: true,
          baseRef: input.source === "branch" ? (input.baseRef ?? "main") : null,
          currentBranch: "codex/storybook",
          defaultBranch: "main",
          errorMessage: null,
        };
      }
      return {
        cwd: input.cwd,
        source: input.source,
        patch: "",
        files: [],
        isGitRepository: false,
        baseRef: input.baseRef ?? null,
        currentBranch: null,
        defaultBranch: null,
        errorMessage: "Git review is unavailable outside Electron.",
      };
    }
    case "git:review:diff": {
      const [input] = args as [
        {
          cwd: string;
          source: "unstaged" | "staged" | "branch";
          files?: Array<{ path: string; previousPath?: string | null }>;
          baseRef?: string | null;
          baseBranch?: string | null;
        },
      ];
      const snapshot = (await invoke("git:review:snapshot", {
        cwd: input.cwd,
        source: input.source,
        baseRef: input.baseBranch ?? input.baseRef ?? null,
      })) as StoryGitReviewSnapshot;
      const result = toStoryReviewDiffResult(snapshot);
      const requestedPaths = new Set(
        (input.files ?? []).flatMap((file) =>
          file.previousPath ? [file.path, file.previousPath] : [file.path],
        ),
      );
      if (requestedPaths.size === 0) return result;

      const files = result.files.filter(
        (file) =>
          requestedPaths.has(file.path) ||
          (file.previousPath ? requestedPaths.has(file.previousPath) : false),
      );
      return {
        ...result,
        patch: files
          .map((file) => file.diff)
          .filter(Boolean)
          .join("\n"),
        files,
      };
    }
    case "git:review:patch": {
      const [input] = args as [
        {
          cwd: string;
          source: "unstaged" | "staged" | "branch";
          baseRef?: string | null;
          baseBranch?: string | null;
        },
      ];
      const result = (await invoke("git:review:diff", {
        cwd: input.cwd,
        source: input.source,
        baseRef: input.baseBranch ?? input.baseRef ?? null,
        snapshotGeneration: 1,
      })) as ReturnType<typeof toStoryReviewDiffResult>;
      return {
        cwd: result.cwd,
        source: result.source,
        diff: {
          type: "success" as const,
          unifiedDiff: result.patch,
          unifiedDiffBytes: new TextEncoder().encode(result.patch).byteLength,
        },
        isGitRepository: result.isGitRepository,
        baseRef: result.baseRef,
        currentBranch: result.currentBranch,
        defaultBranch: result.defaultBranch,
        errorMessage: result.errorMessage,
      };
    }
    case "git:review:branch-diff-stats": {
      const [input] = args as [
        { cwd: string; baseRef?: string | null; baseBranch?: string | null },
      ];
      const result = (await invoke("git:review:diff", {
        cwd: input.cwd,
        source: "branch",
        baseRef: input.baseBranch ?? input.baseRef ?? null,
        snapshotGeneration: 1,
      })) as ReturnType<typeof toStoryReviewDiffResult>;
      return {
        cwd: result.cwd,
        baseRef: result.baseRef,
        files: result.files.map((file) => ({
          path: file.path,
          previousPath: file.previousPath,
          status: file.status,
          rawStatus: file.rawStatus ?? null,
          oldOid: file.oldOid ?? null,
          newOid: file.newOid ?? null,
          revision: file.revision ?? null,
          additions: file.additions,
          deletions: file.deletions,
        })),
        additions: result.files.reduce(
          (total, file) => total + file.additions,
          0,
        ),
        deletions: result.files.reduce(
          (total, file) => total + file.deletions,
          0,
        ),
        isGitRepository: result.isGitRepository,
        currentBranch: result.currentBranch,
        defaultBranch: result.defaultBranch,
        errorMessage: result.errorMessage,
      };
    }
    case "git:review:branch-commits": {
      const [input] = args as [{ cwd: string; baseBranch?: string | null }];
      if (isStorybookRuntime()) {
        return {
          cwd: input.cwd,
          baseBranch: input.baseBranch ?? "main",
          commits: [
            {
              sha: "1111111111111111111111111111111111111111",
              committedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
              subject: "feat: add review right-panel parity foundations",
            },
            {
              sha: "2222222222222222222222222222222222222222",
              committedAt: new Date(Date.now() - 52 * 60_000).toISOString(),
              subject: "fix: preserve text action selection",
            },
            {
              sha: "3333333333333333333333333333333333333333",
              committedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
              subject: "fix: stabilize canvas excalidraw lifecycle",
            },
          ],
          errorMessage: null,
        };
      }
      return {
        cwd: input.cwd,
        baseBranch: input.baseBranch ?? null,
        commits: [],
        errorMessage: "Branch commits are unavailable outside Electron.",
      };
    }
    case "git:merge-base": {
      const [input] = args as [{ cwd: string; baseBranch: string }];
      return {
        cwd: input.cwd,
        baseBranch: input.baseBranch,
        mergeBaseSha: input.baseBranch.trim()
          ? "1111111111111111111111111111111111111111"
          : null,
        errorMessage: input.baseBranch.trim()
          ? null
          : "Base branch is required.",
      };
    }
    case "git:review:search": {
      const [input] = args as [
        {
          cwd: string;
          source: "unstaged" | "staged" | "branch";
          query: string;
        },
      ];
      if (isStorybookRuntime()) {
        const query = input.query.trim();
        const normalizedQuery = query.toLowerCase();
        const candidates = [
          { path: "src/feature.ts", text: "src/feature.ts", hunkId: "path" },
          { path: "src/file-090.ts", text: "src/file-090.ts", hunkId: "path" },
          { path: "src/app.ts", text: "export const title = 'Nodex';", hunkId: "0" },
          {
            path: "src/workbench.tsx",
            text: "export function DiffTreeWorkbench() {}",
            hunkId: "0",
          },
        ] as const;
        const candidate = normalizedQuery
          ? candidates.find(({ path, text }) =>
              path.toLowerCase().includes(normalizedQuery) ||
              text.toLowerCase().includes(normalizedQuery),
            )
          : undefined;
        const start = candidate
          ? candidate.text.toLowerCase().indexOf(normalizedQuery)
          : -1;
        const matches = candidate && start >= 0
          ? [{
              path: candidate.path,
              hunkId: candidate.hunkId,
              lineStart: 1,
              lineEnd: 1,
              start,
              end: start + query.length,
              snippet: {
                before: candidate.text.slice(Math.max(0, start - 24), start),
                match: candidate.text.slice(start, start + query.length),
                after: candidate.text.slice(start + query.length, start + query.length + 24),
              },
            }]
          : [];
        return {
          type: "success",
          source: input.source,
          query,
          matches,
          totalMatches: matches.length,
          isCapped: false,
        };
      }
      return {
        type: "error",
        source: input.source,
        query: input.query.trim(),
      };
    }
    case "git:init": {
      const [cwd] = args as [string];
      return {
        cwd,
        source: "unstaged" as const,
        patch: "",
        files: [],
        isGitRepository: true,
        baseRef: null,
        currentBranch: "main",
        defaultBranch: "main",
        errorMessage: null,
        snapshotGeneration: 1,
      };
    }
    case "git:action:status": {
      const [input] = args as [{ cwd: string }];
      if (isStorybookRuntime()) {
        const hasNoDiff = input.cwd.includes("no-diff");
        const hasNoGit = input.cwd.includes("no-git");
        return {
          cwd: input.cwd,
          isGitRepository: !hasNoGit,
          currentBranch: hasNoGit ? null : "codex/storybook",
          defaultBranch: hasNoGit ? null : "main",
          upstreamBranch: hasNoDiff ? "origin/codex/storybook" : null,
          remotes: hasNoGit ? [] : ["origin"],
          hasHeadCommit: !hasNoGit,
          hasStagedChanges: !hasNoDiff && !hasNoGit,
          hasUnstagedChanges: !hasNoDiff && !hasNoGit,
          hasUntrackedFiles: false,
          hasUncommittedChanges: !hasNoDiff && !hasNoGit,
          commitsAhead: hasNoDiff || hasNoGit ? 0 : 1,
          canCommit: !hasNoDiff && !hasNoGit,
          canPush: !hasNoGit,
          pushNeedsUpstream: !hasNoDiff && !hasNoGit,
          errorMessage: null,
        };
      }
      return {
        cwd: input.cwd,
        isGitRepository: false,
        currentBranch: null,
        defaultBranch: null,
        upstreamBranch: null,
        remotes: [],
        hasHeadCommit: false,
        hasStagedChanges: false,
        hasUnstagedChanges: false,
        hasUntrackedFiles: false,
        hasUncommittedChanges: false,
        commitsAhead: 0,
        canCommit: false,
        canPush: false,
        pushNeedsUpstream: false,
        errorMessage: "Git actions are unavailable outside Electron.",
      };
    }
    case "git:action:pull-request-message:generate": {
      const [input] = args as [
        {
          cwd: string;
          title?: string | null;
          body?: string | null;
          headBranch?: string | null;
        },
      ];
      return {
        cwd: input.cwd,
        status: isStorybookRuntime() ? "success" : "error",
        title: isStorybookRuntime()
          ? input.title?.trim() ||
            input.headBranch?.trim() ||
            "Storybook pull request"
          : null,
        body: isStorybookRuntime()
          ? input.body?.trim() || "Generated pull request summary."
          : null,
        stderr: "",
        errorMessage: isStorybookRuntime()
          ? null
          : "Git actions are unavailable outside Electron.",
      };
    }
    case "git:action:commit-message:generate": {
      const [input] = args as [{ cwd: string }];
      return {
        cwd: input.cwd,
        status: "error",
        message: null,
        stderr: "",
        errorMessage: "Git actions are unavailable outside Electron.",
      };
    }
    case "git:action:commit":
    case "git:action:push": {
      const [input] = args as [{ cwd: string }];
      return {
        cwd: input.cwd,
        status: isStorybookRuntime() ? "success" : "error",
        branch: isStorybookRuntime() ? "codex/storybook" : null,
        stdout: "",
        stderr: "",
        errorMessage: isStorybookRuntime()
          ? null
          : "Git actions are unavailable outside Electron.",
      };
    }
    case "git:action:cancel":
      return {
        canceled: isStorybookRuntime(),
      };
    case "codex:review:start": {
      const [input] = args as [{ threadId: string }];
      return {
        reviewThreadId: input.threadId,
        turn: {
          id: "storybook-review-turn",
          status: "in_progress",
        },
      };
    }
    case "git:apply-patch": {
      const [input] = args as [
        {
          cwd: string;
          diff: string;
          target: "staged" | "unstaged";
          revert?: boolean;
        },
      ];
      if (isStorybookRuntime()) {
        return {
          status: "success" as const,
          appliedPaths: [
            input.diff.includes("src/feature.ts")
              ? "src/feature.ts"
              : "src/workbench.tsx",
          ],
          skippedPaths: [],
          conflictedPaths: [],
          errorCode: null,
          errorMessage: null,
        };
      }
      return {
        status: "error" as const,
        appliedPaths: [],
        skippedPaths: [],
        conflictedPaths: [],
        errorCode: "unavailableInBrowser",
        errorMessage: "Git patch application is unavailable outside Electron.",
      };
    }
    case "git:branch:watch:start":
    case "git:branch:watch:stop": {
      return;
    }
    case "asset:resolve-path": {
      const [source] = args as [string];
      const res = await fetch(toApiUrl("/api/assets/resolve-path"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      return data.path ?? null;
    }
    case "clipboard:write-image": {
      return {
        ok: false as const,
        message: "Copy image is unavailable outside the desktop app.",
      };
    }
    case "clipboard:inspect-paste": {
      return { items: [] };
    }
    case "composer:pick-files": {
      return [];
    }
    case "codex:thread:goal:materialize-draft": {
      const [draft] = args as [{ objective?: string }];
      return {
        objective: draft.objective?.trim() ?? "",
        attachmentDirectory: null,
      };
    }
    case "codex:thread:goal:materialized-cleanup": {
      return undefined;
    }
    case "codex:thread:goal:editable-objective:read": {
      const [objective] = args as [string];
      return objective;
    }
    case "window:show-emoji-panel": {
      return false;
    }
    case "window:new": {
      return false;
    }
    case "shell:open-file-link": {
      return false;
    }
    case "worktrees:list": {
      return [];
    }
    case "worktrees:environments:list": {
      return [];
    }
    case "worktrees:environments:configs:list": {
      return [];
    }
    case "worktrees:environments:configs:list-for-workspace": {
      return [];
    }
    case "worktrees:environments:config:read": {
      const [projectId] = args as [string, string | null | undefined];
      return {
        projectId,
        projectName: "Storybook workspace",
        workspacePath: "/tmp/storybook",
        configPath: ".codex/environments/environment.toml",
        nextConfigPath: ".codex/environments/environment.toml",
        configExists: false,
        configs: [],
        environment: null,
        parseErrorMessage: null,
        readErrorMessage: null,
      };
    }
    case "worktrees:environments:config:save": {
      const [input] = args as [
        import("../../shared/types").UpdateWorktreeEnvironmentConfigInput,
      ];
      return {
        projectId: input.projectId,
        projectName: "Storybook workspace",
        workspacePath: "/tmp/storybook",
        configPath: input.configPath,
        nextConfigPath: ".codex/environments/environment-2.toml",
        configExists: true,
        configs: [
          {
            configPath: input.configPath,
            fileName: "environment.toml",
            state: "success",
            exists: true,
            name: input.environment.name,
            hasSetupScript: Boolean(input.environment.setup.script),
            hasCleanupScript: Boolean(input.environment.cleanup.script),
            actionCount: input.environment.actions.length,
            parseErrorMessage: null,
            readErrorMessage: null,
            environment: input.environment,
          },
        ],
        environment: input.environment,
        parseErrorMessage: null,
        readErrorMessage: null,
      };
    }
    case "codex:permission:custom-description:get": {
      if (isStorybookRuntime()) {
        return "Uses the permission policy defined in your local Codex config.";
      }
      return null;
    }
    case "codex:permission:state:get":
    case "codex:permission:mode:set":
    case "codex:permission:config-value:set": {
      return {
        mode: "auto",
        effectivePreset: "auto",
        availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        sandbox: {
          type: "workspaceWrite",
          writableRoots: ["/tmp/storybook"],
          readOnlyAccess: {
            type: "fullAccess",
          },
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        autoReviewAvailable: true,
        configTarget: {
          source: "user",
          filePath: "/tmp/storybook/config.toml",
        },
        customDescription:
          "Uses the permission policy defined in your local Codex config.",
      };
    }
    case "workspace:pick-directory": {
      return null;
    }
    case "worktrees:delete": {
      return false;
    }
    default:
      throw new Error(`Unknown IPC channel: ${channel}`);
  }
}

type ProjectEventName =
  | "board-changed"
  | "page-ownership-paths-changed"
  | "database-changed"
  | "project-sessions-changed"
  | "projection-stream";

type ProjectEventListener = (
  event: Readonly<Record<string, unknown>>,
) => void;

interface BrowserProjectEventStream {
  readonly source: EventSource;
  readonly listeners: Map<ProjectEventName, Set<ProjectEventListener>>;
}

const browserProjectEventStreams = new Map<
  string,
  BrowserProjectEventStream
>();

const isEventRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ensureBrowserProjectEventStream = (
  projectId: string,
): BrowserProjectEventStream | null => {
  const existing = browserProjectEventStreams.get(projectId);
  if (existing) return existing;
  if (typeof EventSource === "undefined") return null;

  const source = new EventSource(
    toApiUrl(
      `/api/projects/${encodeURIComponent(projectId)}/events`,
    ),
  );
  const stream: BrowserProjectEventStream = {
    source,
    listeners: new Map(),
  };
  browserProjectEventStreams.set(projectId, stream);
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as unknown;
      if (!isEventRecord(event)) return;
      if (
        typeof event.projectId === "string" &&
        event.projectId !== projectId
      ) {
        return;
      }
      const eventName = event.event;
      if (eventName === "connected") return;
      if (
        eventName !== "board-changed" &&
        eventName !== "page-ownership-paths-changed" &&
        eventName !== "database-changed" &&
        eventName !== "project-sessions-changed" &&
        eventName !== "projection-stream"
      ) {
        return;
      }
      for (const listener of [...(stream.listeners.get(eventName) ?? [])]) {
        try {
          listener(event);
        } catch {
          // One consumer cannot starve the other Project event consumers.
        }
      }
    } catch {
      // Ignore malformed or unrelated SSE payloads.
    }
  };
  return stream;
};

const subscribeBrowserProjectEvent = (
  projectId: string,
  eventName: ProjectEventName,
  listener: ProjectEventListener,
): (() => void) => {
  const stream = ensureBrowserProjectEventStream(projectId);
  if (!stream) return () => {};
  const listeners = stream.listeners.get(eventName) ?? new Set();
  listeners.add(listener);
  stream.listeners.set(eventName, listeners);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const current = browserProjectEventStreams.get(projectId);
    if (current !== stream) return;
    const currentListeners = stream.listeners.get(eventName);
    currentListeners?.delete(listener);
    if (currentListeners?.size === 0) {
      stream.listeners.delete(eventName);
    }
    if (stream.listeners.size > 0) return;
    browserProjectEventStreams.delete(projectId);
    stream.source.close();
  };
};

function subscribeBoardChanges(
  projectId: string,
  callback: (event: BoardChangeEvent) => void,
): () => void {
  return subscribeBrowserProjectEvent(projectId, "board-changed", (event) => {
    callback(event as unknown as BoardChangeEvent);
  });
}

function subscribeProjectionStream(
  scope: ProjectionScope,
  listener: (message: ProjectionStreamMessage) => void,
): () => void {
  const deliver = (envelope: Readonly<Record<string, unknown>>): void => {
    const message = envelope.message as ProjectionStreamMessage | undefined;
    if (!message || message.scope.kind !== scope.kind) return;
    if (message.scope.libraryId !== scope.libraryId) return;
    if (
      scope.kind === "project"
      && message.scope.kind === "project"
      && message.scope.projectId !== scope.projectId
    ) return;
    listener(message);
  };
  if (scope.kind === "project") {
    return subscribeBrowserProjectEvent(
      scope.projectId,
      "projection-stream",
      deliver,
    );
  };
  if (typeof EventSource === "undefined") return () => {};
  browserLibraryProjectionEventListeners.add(deliver);
  ensureBrowserLibraryEventSource();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    browserLibraryProjectionEventListeners.delete(deliver);
    closeBrowserLibraryEventSourceIfUnused();
  };
}

function subscribePageOwnershipPathChanges(
  projectId: string,
  callback: (
    event: import("../../shared/page-ownership-path-events").PageOwnershipPathsChangedEvent,
  ) => void,
): () => void {
  return subscribeBrowserProjectEvent(
    projectId,
    "page-ownership-paths-changed",
    (event) => callback({
      changeKind: event.changeKind as
        import("../../shared/page-ownership-path-events").PageOwnershipPathsChangedEvent["changeKind"],
    }),
  );
}

function subscribeDatabaseChanges(
  projectId: string,
  callback: (event: DatabaseChangeEvent) => void,
): () => void {
  return subscribeBrowserProjectEvent(
    projectId,
    "database-changed",
    (event) => callback(event as unknown as DatabaseChangeEvent),
  );
}

let browserLibraryEventSource: EventSource | null = null;
const browserLibraryEventListeners = new Set<(
  event: import("../../shared/library-events").LibraryNavigationChangedEvent,
) => void>();
const browserLibraryProjectionEventListeners =
  new Set<ProjectEventListener>();

const ensureBrowserLibraryEventSource = (): void => {
  if (browserLibraryEventSource || typeof EventSource === "undefined") return;
  browserLibraryEventSource = new EventSource(
    toApiUrl("/api/library-module/events"),
  );
  browserLibraryEventSource.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as unknown;
      if (!isEventRecord(event)) return;
      if (event.event === "connected") return;
      if (event.event === "projection-stream") {
        for (const listener of [...browserLibraryProjectionEventListeners]) {
          try {
            listener(event);
          } catch {
            // One consumer cannot starve the other Library event consumers.
          }
        }
        return;
      }
      if (
        event.event !== "library-navigation-changed"
        || event.version !== 1
        || typeof event.libraryId !== "string"
      ) return;
      for (const listener of [...browserLibraryEventListeners]) {
        try {
          listener(event as unknown as
            import("../../shared/library-events").LibraryNavigationChangedEvent);
        } catch {
          // One consumer cannot starve the other Library event consumers.
        }
      }
    } catch {
      // A malformed event is only an invalidation miss; the next read heals it.
    }
  };
};

const closeBrowserLibraryEventSourceIfUnused = (): void => {
  if (
    browserLibraryEventListeners.size > 0
    || browserLibraryProjectionEventListeners.size > 0
  ) return;
  browserLibraryEventSource?.close();
  browserLibraryEventSource = null;
};

function subscribeLibraryChanges(
  callback: (
    event: import("../../shared/library-events").LibraryNavigationChangedEvent,
  ) => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {};
  browserLibraryEventListeners.add(callback);
  ensureBrowserLibraryEventSource();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    browserLibraryEventListeners.delete(callback);
    closeBrowserLibraryEventSourceIfUnused();
  };
}

function subscribeProjectSessionChanges(
  callback: (event: ProjectSessionsChangeEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => {};
  }
  const eventSource = new EventSource(toApiUrl("/api/project-sessions/events"));
  eventSource.onmessage = (message) => {
    try {
      const data = JSON.parse(message.data) as ProjectSessionsChangeEvent & {
        event?: string;
      };
      if (data.event === "connected") {
        callback({
          summaryScopes: [{ kind: "all" }],
          detailInvalidation: { kind: "all" },
          changeType: "update",
        });
        return;
      }
      if (data.event !== "project-sessions-changed") return;
      if (!Array.isArray(data.summaryScopes)) return;
      if (!data.detailInvalidation || typeof data.detailInvalidation !== "object") return;
      if (
        data.detailInvalidation.kind === "sessions"
        && !Array.isArray(data.detailInvalidation.sessionIds)
      ) return;
      if (
        data.detailInvalidation.kind !== "sessions"
        && data.detailInvalidation.kind !== "all"
      ) return;
      callback(data);
    } catch {
      // A malformed invalidation is healed by a later event or explicit refresh.
    }
  };
  return () => eventSource.close();
}

function subscribeProjectChanges(
  callback: (event: ProjectsChangeEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  const es = new EventSource(toApiUrl("/api/projects/events"));

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as ProjectsChangeEvent & {
        event?: string;
      };
      if (data.event === "projects-changed") {
        callback({
          projectId:
            typeof data.projectId === "string" ? data.projectId : undefined,
          changeType: data.changeType,
        });
      }
    } catch {
      // ignore parse errors
    }
  };

  return () => es.close();
}

function subscribeCodexHostMessages(
  callback: (message: import("./types").CodexHostMessage) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCodexEvents(
  callback: (event: import("./types").CodexEvent) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCodexRendererClientRequests(
  callback: (
    message: import("./types").CodexRendererClientRequestMessage,
  ) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeDesktopNotificationActions(
  callback: (
    payload: import("./types").DesktopNotificationActionPayload & {
      conversationId: string | null;
      requestId: import("./types").CodexProtocolRequestId | null;
      approvalKind: import("./types").CodexApprovalKind | null;
    },
  ) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeGitBranchChanges(
  callback: (event: { cwd: string }) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeAppUpdateStatus(
  callback: (status: AppUpdateStatus) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCommandKeymapChanges(
  callback: (state: CommandKeymapState) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCodexScheduledAutomationChanges(
  callback: (
    event: import("./types").CodexScheduledAutomationChangedEvent,
  ) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCodexAutomationRunsUpdates(
  callback: (event: import("./types").CodexAutomationRunsUpdatedEvent) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCodexHooksChanged(
  callback: (
    event: import("../../shared/codex-hooks").CodexHooksChangedEvent,
  ) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCodexPendingWorktreesChanged(
  callback: (
    event: import("../../shared/codex-pending-worktree").CodexPendingWorktreesChangedEvent,
  ) => void,
): () => void {
  return browserPendingWorktreeFallback.subscribe(callback);
}

function subscribeCodexPendingWorktreeWarnings(
  callback: (
    event: import("../../shared/codex-pending-worktree").CodexPendingWorktreeWarningEvent,
  ) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribePersistedAtomUpdates(
  callback: (
    update: import("../../shared/ipc-api").PersistedAtomEvent,
  ) => void,
): () => void {
  void callback;
  return () => {};
}

async function getWindowFocusState(): Promise<boolean> {
  return typeof document !== "undefined"
    ? document.visibilityState !== "hidden"
    : true;
}

function subscribeWindowFocusChanges(
  callback: (isFocused: boolean) => void,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    void callback;
    return () => {};
  }

  const emit = () => {
    callback(document.visibilityState !== "hidden");
  };

  window.addEventListener("focus", emit);
  window.addEventListener("blur", emit);
  document.addEventListener("visibilitychange", emit);
  return () => {
    window.removeEventListener("focus", emit);
    window.removeEventListener("blur", emit);
    document.removeEventListener("visibilitychange", emit);
  };
}

function subscribeGitReviewLiveQueries(
  callback: (
    event: import("../../shared/types").GitReviewLiveEvent,
  ) => void,
): () => void {
  browserGitReviewLiveQuerySubscribers.add(callback);
  return () => {
    browserGitReviewLiveQuerySubscribers.delete(callback);
  };
}

export const browserRendererTransport = {
  kind: "browser" as const,
  readPageLifecyclePreflight(
    projectId: string,
    pageId: string,
  ): Promise<PageLifecyclePreflightResultV2> {
    return invoke(
      "pages:lifecycle:preflight",
      projectId,
      pageId,
    ) as Promise<PageLifecyclePreflightResultV2>;
  },
  mutatePageLifecycle(
    projectId: string,
    request: PageLifecycleMutationRequestV2,
  ): Promise<PageLifecycleMutationCommandResultV2> {
    return invoke(
      "pages:lifecycle:apply",
      projectId,
      request,
    ) as Promise<PageLifecycleMutationCommandResultV2>;
  },
  async listPageHistory(
    request: ListPageHistoryRequest,
  ): Promise<PageHistoryCommandResult> {
    const query = new URLSearchParams();
    if (request.pageSize !== undefined) {
      query.set("pageSize", String(request.pageSize));
    }
    if (request.before) {
      query.set("beforeSource", request.before.source);
      query.set("beforeOccurredAt", request.before.occurredAt);
      if (request.before.source === "document_version") {
        query.set("beforeVersionId", request.before.versionId);
      } else {
        query.set("beforeChangeSeq", String(request.before.changeSeq));
      }
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(request.requestingProjectId)}/pages/${encodeURIComponent(request.pageId)}/history${suffix}`,
      ),
      { headers: { Accept: "application/json" } },
    );
    return parsePageHistoryCommandResult(await response.json());
  },
  async getOwnedDocumentDescriptor(
    projectId: string,
    ownerBlockId: string,
  ) {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/blocks/${encodeURIComponent(ownerBlockId)}/document`,
      ),
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error(
        `Owned Document lookup failed with status ${response.status}`,
      );
    }
    return decodeOwnedDocumentDescriptorHttp(await response.text());
  },
  async prepareOwnedBlockDocument(projectId: string, ownerBlockId: string) {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/blocks/${encodeURIComponent(ownerBlockId)}/document/prepare`,
      ),
      {
        method: "POST",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) {
      try {
        return {
          ok: false as const,
          error: decodeDocumentHttpError(await response.text()),
        };
      } catch {
        return {
          ok: false as const,
          error: {
            code: "invalid_response" as const,
            message: `Owned Document preparation failed with status ${response.status}`,
            retryable: false,
            resetRequired: false,
          },
        };
      }
    }
    return {
      ok: true as const,
      value: decodeOwnedDocumentDescriptorHttp(await response.text()),
    };
  },
  async prepareLibraryOwnedBlockDocument(ownerBlockId: string) {
    const response = await fetch(
      toApiUrl(
        `/api/library/blocks/${encodeURIComponent(ownerBlockId)}/document/prepare`,
      ),
      { method: "POST", headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      try {
        return {
          ok: false as const,
          error: decodeDocumentHttpError(await response.text()),
        };
      } catch {
        return {
          ok: false as const,
          error: {
            code: "invalid_response" as const,
            message: `Library Document preparation failed with status ${response.status}`,
            retryable: false,
            resetRequired: false,
          },
        };
      }
    }
    return {
      ok: true as const,
      value: decodeLibraryOwnedDocumentDescriptorHttp(await response.text()),
    };
  },
  createDocumentSyncAdapter(projectId: string) {
    return createHttpDocumentSyncAdapter({ projectId });
  },
  createLibraryDocumentSyncAdapter() {
    return createHttpLibraryDocumentSyncAdapter();
  },
  createCanvasSceneSyncAdapter(projectId: string) {
    return createHttpCanvasSceneSyncAdapter({ projectId });
  },
  async mutateDocument(
    projectId: string,
    documentId: string,
    request: DocumentMutationRequest,
  ): Promise<DocumentOperationCommandResult> {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/mutations`,
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    return parseDocumentOperationCommandResult(await response.json());
  },
  async applyAdditionalDocumentCommand(
    projectId: string,
    request: PublicAdditionalDocumentCommandRequest,
  ): Promise<AdditionalDocumentCommandResult> {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/document-commands`,
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    return parseAdditionalDocumentCommandResult(await response.json());
  },
  async transferBlocks(
    projectId: string,
    intent: PublicBlockTransferIntent,
  ): Promise<BlockTransferCommandResult> {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/block-transfers`,
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(intent),
      },
    );
    return decodeBlockTransferHttpResult(await response.json());
  },
  async createDocumentVersionCheckpoint(
    projectId: string,
    documentId: string,
    request: CreateDocumentVersionCheckpoint,
  ): Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>> {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/checkpoints`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
      },
    );
    return decodeDocumentHistoryResponse(await response.json());
  },
  async listDocumentVersions(
    request: ListDocumentVersions,
  ): Promise<
    DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>
  > {
    const query = new URLSearchParams();
    if (request.limit !== undefined) query.set("limit", String(request.limit));
    if (request.before) {
      query.set("beforeHeadSeq", String(request.before.baseHeadSeq));
      query.set("beforeCreatedAt", request.before.createdAt);
      query.set("beforeVersionId", request.before.versionId);
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/versions${suffix}`,
      ),
      { headers: { Accept: "application/json" } },
    );
    return decodeDocumentHistoryResponse(await response.json());
  },
  async getDocumentVersion(
    request: GetDocumentVersion,
  ): Promise<DocumentHistoryCommandResult<DocumentVersionDetail>> {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(request.projectId)}/documents/${encodeURIComponent(request.documentId)}/versions/${encodeURIComponent(request.versionId)}`,
      ),
      { headers: { Accept: "application/json" } },
    );
    return decodeDocumentHistoryResponse(await response.json());
  },
  async restoreDocumentVersion(
    projectId: string,
    documentId: string,
    request: PrepareDocumentVersionRestore,
  ): Promise<DocumentOperationCommandResult> {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(request.versionId)}/restore`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
      },
    );
    return parseDocumentOperationCommandResult(await response.json());
  },
  invoke,
  subscribeBoardChanges,
  subscribeProjectionStream,
  subscribePageOwnershipPathChanges,
  subscribeDatabaseChanges,
  subscribeLibraryChanges,
  subscribeProjectSessionChanges,
  subscribeProjectChanges,
  subscribeCodexHostMessages,
  subscribeCodexEvents,
  subscribeCodexRendererClientRequests,
  subscribeDesktopNotificationActions,
  subscribeGitBranchChanges,
  subscribeGitReviewLiveQueries,
  subscribeAppUpdateStatus,
  subscribeCommandKeymapChanges,
  subscribeCodexScheduledAutomationChanges,
  subscribeCodexAutomationRunsUpdates,
  subscribeCodexHooksChanged,
  subscribeCodexPendingWorktreesChanged,
  subscribeCodexPendingWorktreeWarnings,
  subscribePersistedAtomUpdates,
  getWindowFocusState,
  subscribeWindowFocusChanges,
};
