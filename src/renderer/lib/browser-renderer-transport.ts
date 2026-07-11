import { toApiUrl } from "./http-base";
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
import type {
  BoardChangeEvent,
  ProjectSessionsChangeEvent,
  ProjectsChangeEvent,
} from "../../shared/ipc-api";
import { createHttpDocumentSyncAdapter } from "./http-document-sync-adapter";
import {
  decodeDocumentHttpError,
  decodeOwnedBlockDocumentDescriptorHttp,
} from "../../shared/block-documents/http-contract";

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
const browserCardDescriptionStaging = new Map<
  string,
  {
    input: {
      projectId: string;
      columnId?: string;
      cardId: string;
      sessionId?: string;
      expectedRevision?: number;
    };
    chunks: string[];
  }
>();

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
    ...snapshot,
    patch: files
      .map((file) => file.diff)
      .filter(Boolean)
      .join("\n"),
    files,
  };
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  switch (channel) {
    case "projects:list": {
      const res = await fetch(toApiUrl("/api/projects"));
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
    case "projects:delete": {
      const [projectId] = args as [string];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}`), {
        method: "DELETE",
      });
      const data = await res.json();
      return data.success ?? false;
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
    case "cards:details:get": {
      const [projectId, input] = args as [string, { cardIds: string[] }];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/cards/details`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) return [];
      return res.json();
    }
    case "cards:search": {
      const [input] = args as [
        { projectIds: string[]; query: string; limit?: number },
      ];
      const res = await fetch(toApiUrl("/api/cards/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return [];
      return res.json();
    }
    case "card:create": {
      const [projectId, status, input, sessionId, placement] = args as [
        string,
        string,
        object,
        string | undefined,
        "top" | "bottom" | undefined,
      ];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/board`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...input, sessionId, placement }),
      });
      return res.json();
    }
    case "card:update": {
      const [projectId, status, cardId, updates, sessionId, expectedRevision] =
        args as [string, string, string, object, string?, number?];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/card`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          cardId,
          ...updates,
          sessionId,
          expectedRevision,
        }),
      });
      if (!res.ok) {
        if (res.status === 404 || res.status === 409) {
          return res.json();
        }
        const error = await res.json().catch(() => ({}));
        const message =
          typeof error.error === "string"
            ? error.error
            : `Request failed: ${res.status}`;
        throw new Error(message);
      }
      return res.json();
    }
    case "card:description:update:start": {
      const [input] = args as [
        {
          projectId: string;
          columnId?: string;
          cardId: string;
          sessionId?: string;
          expectedRevision?: number;
        },
      ];
      const stagingId = crypto.randomUUID();
      browserCardDescriptionStaging.set(stagingId, { input, chunks: [] });
      return { stagingId };
    }
    case "card:description:update:chunk": {
      const [stagingId, chunk] = args as [string, string];
      const entry = browserCardDescriptionStaging.get(stagingId);
      if (!entry) throw new Error("Unknown card description staging id");
      entry.chunks.push(chunk);
      return {
        ok: true,
        bytes: entry.chunks.reduce((sum, value) => sum + value.length, 0),
      };
    }
    case "card:description:update:abort": {
      const [stagingId] = args as [string];
      return browserCardDescriptionStaging.delete(stagingId);
    }
    case "card:description:update:finish": {
      const [stagingId] = args as [string];
      const entry = browserCardDescriptionStaging.get(stagingId);
      if (!entry) throw new Error("Unknown card description staging id");
      browserCardDescriptionStaging.delete(stagingId);
      const params = new URLSearchParams({ cardId: entry.input.cardId });
      if (entry.input.columnId) params.set("status", entry.input.columnId);
      if (entry.input.sessionId) params.set("sessionId", entry.input.sessionId);
      if (typeof entry.input.expectedRevision === "number") {
        params.set("expectedRevision", String(entry.input.expectedRevision));
      }
      const res = await fetch(
        toApiUrl(
          `/api/projects/${entry.input.projectId}/card/description?${params.toString()}`,
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: entry.chunks.join(""),
        },
      );
      if (!res.ok && res.status !== 404 && res.status !== 409) {
        const error = await res.json().catch(() => ({}));
        const message =
          typeof error.error === "string"
            ? error.error
            : `Request failed: ${res.status}`;
        throw new Error(message);
      }
      return res.json();
    }
    case "card:get": {
      const [projectId, cardId, status] = args as [string, string, string?];
      const params = new URLSearchParams({ cardId });
      if (status) params.set("status", status);
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card?${params.toString()}`),
      );
      if (!res.ok) return null;
      return res.json();
    }
    case "card:delete": {
      const [projectId, status, cardId, sessionId] = args as [
        string,
        string,
        string,
        string?,
      ];
      const params = new URLSearchParams({ status, cardId });
      if (sessionId) params.set("sessionId", sessionId);
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card?${params}`),
        { method: "DELETE" },
      );
      const data = await res.json();
      return data.success ?? false;
    }
    case "card:move": {
      const [input] = args as [{ projectId: string; sessionId?: string }];
      const { projectId, ...rest } = input;
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/move`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rest),
      });
      const data = await res.json();
      return data.success ?? false;
    }
    case "card:move-many": {
      const [input] = args as [{ projectId: string; sessionId?: string }];
      const { projectId, ...rest } = input;
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/move-many`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rest),
        },
      );
      const data = await res.json();
      return data.success ?? false;
    }
    case "card:move-to-project": {
      const [input] = args as [{ sourceProjectId: string; sessionId?: string }];
      const { sourceProjectId, ...rest } = input;
      const res = await fetch(
        toApiUrl(`/api/projects/${sourceProjectId}/card-move-to-project`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rest),
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
    case "window-sessions:bootstrap": {
      return createBrowserWindowSessionBootstrap(browserWindowSessionLayout);
    }
    case "window-sessions:save-layout": {
      const [layout] = args as [WorkbenchLayoutSnapshot];
      browserWindowSessionLayout = layout;
      return createBrowserWindowSessionBootstrap(browserWindowSessionLayout);
    }
    case "window-sessions:update-bounds": {
      return undefined;
    }
    case "card:import-block-drop": {
      const [projectId, input, sessionId] = args as [string, object, string?];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card-import-block-drop`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, sessionId }),
        },
      );
      return res.json();
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
    case "card:occurrence:complete": {
      const [projectId, input, sessionId] = args as [
        string,
        { cardId: string; occurrenceStart: Date; source: string },
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card-occurrence/complete`),
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
    case "card:occurrence:skip": {
      const [projectId, input, sessionId] = args as [
        string,
        { cardId: string; occurrenceStart: Date; source: string },
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card-occurrence/skip`),
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
    case "card:occurrence:update": {
      const [projectId, input, sessionId] = args as [
        string,
        {
          cardId: string;
          occurrenceStart: Date;
          scope: string;
          updates: Record<string, unknown>;
        },
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card-occurrence`),
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
    case "card:apply-editor-drop": {
      const [projectId, input, sessionId] = args as [string, object, string?];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/card-editor-drop`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, sessionId }),
        },
      );
      return res.json();
    }
    case "history:recent": {
      const [projectId, sessionId] = args as [string, string?];
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/history${params}`),
      );
      return res.json();
    }
    case "history:card": {
      const [projectId, cardId] = args as [string, string];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/history/card?cardId=${cardId}`),
      );
      return res.json();
    }
    case "history:card-version-preview": {
      const [projectId, cardId, historyId] = args as [string, string, number];
      const params = new URLSearchParams({
        cardId,
        historyId: String(historyId),
      });
      const res = await fetch(
        toApiUrl(
          `/api/projects/${projectId}/history/card-version-preview?${params.toString()}`,
        ),
      );
      return res.json();
    }
    case "history:undo": {
      const [projectId, sessionId] = args as [string, string?];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/undo`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      return res.json();
    }
    case "history:redo": {
      const [projectId, sessionId] = args as [string, string?];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/redo`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      return res.json();
    }
    case "history:revert": {
      const [projectId, historyId, sessionId] = args as [
        string,
        number,
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/history/revert`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ historyId, sessionId }),
        },
      );
      return res.json();
    }
    case "history:restore": {
      const [projectId, cardId, historyId, sessionId] = args as [
        string,
        string,
        number,
        string?,
      ];
      const res = await fetch(
        toApiUrl(`/api/projects/${projectId}/history/restore`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, historyId, sessionId }),
        },
      );
      return res.json();
    }
    case "db:schema": {
      const [projectId] = args as [string];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/schema`));
      return res.json();
    }
    case "db:query": {
      const [projectId, sql, params] = args as [string, string, unknown[]?];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/query`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      });
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
          files?: string[];
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
      const requestedPaths = new Set(input.files ?? []);
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
    case "git:review:file-contents": {
      const [input] = args as [
        {
          cwd: string;
          source: "unstaged" | "staged" | "branch";
          path: string;
          previousPath?: string | null;
        },
      ];
      if (isStorybookRuntime()) {
        if (input.cwd.includes("large-diff")) {
          return {
            path: input.path,
            previousPath: input.previousPath ?? null,
            oldText: "export const large = true;\n",
            newText: `export const large = true;\n${Array.from({ length: 40 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n")}\n`,
            oldExists: true,
            newExists: true,
            errorMessage: null,
          };
        }
        return {
          path: input.path,
          previousPath: input.previousPath ?? null,
          oldText:
            "export const title = 'Nodex';\nexport const version = '1.0.0';\n",
          newText:
            "export const title = 'Nodex';\nexport const version = '1.0.0';\nexport const review = true;\n",
          oldExists: true,
          newExists: true,
          errorMessage: null,
        };
      }
      return {
        path: input.path,
        previousPath: input.previousPath ?? null,
        oldText: null,
        newText: null,
        oldExists: false,
        newExists: false,
        errorMessage: "Review file contents are unavailable outside Electron.",
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
        const normalizedQuery = input.query.trim().toLowerCase();
        const matchingPaths =
          normalizedQuery.length === 0
            ? []
            : normalizedQuery.includes("feature")
              ? ["src/feature.ts"]
              : normalizedQuery.includes("file-090")
                ? ["src/file-090.ts"]
                : normalizedQuery.includes("app") ||
                    normalizedQuery.includes("title")
                  ? ["src/app.ts"]
                  : normalizedQuery.includes("workbench") ||
                      normalizedQuery.includes("difftree")
                    ? ["src/workbench.tsx"]
                    : [];
        return {
          query: input.query,
          matchingPaths,
        };
      }
      return {
        query: input.query,
        matchingPaths: [],
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
    case "canvas:get": {
      const [projectId] = args as [string];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/canvas`));
      return res.json();
    }
    case "canvas:save": {
      const [projectId, data] = args as [
        string,
        { elements: string; appState: string; files: string; updated: string },
      ];
      const res = await fetch(toApiUrl(`/api/projects/${projectId}/canvas`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await res.json();
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

function subscribeBoardChanges(
  projectId: string,
  callback: (event: BoardChangeEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  const es = new EventSource(toApiUrl(`/api/projects/${projectId}/events`));

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as BoardChangeEvent & {
        event?: string;
      };
      if (data.event === "board-changed") {
        callback(data);
      }
    } catch {
      // ignore parse errors
    }
  };

  return () => es.close();
}

function subscribeProjectSessionChanges(
  projectId: string | null,
  callback: (event: ProjectSessionsChangeEvent) => void,
): () => void {
  if (projectId === null) {
    void callback;
    return () => {};
  }
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  const es = new EventSource(toApiUrl(`/api/projects/${projectId}/events`));

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { event?: string };
      if (data.event === "project-sessions-changed") {
        callback({ projectId, changeType: "update" });
      }
    } catch {
      // ignore parse errors
    }
  };

  return () => es.close();
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
      requestId: string | null;
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

function subscribeCommandPaletteThreadIndexUpdates(
  callback: (
    event: import("./types").CommandPaletteThreadIndexUpdatedEvent,
  ) => void,
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

function subscribePersistedAtomUpdates(
  callback: (
    update: import("../../shared/ipc-api").PersistedAtomUpdate,
  ) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCrossWindowDragActiveChanges(
  callback: (preview: import("../../shared/cross-window-drag").CrossWindowDragPreview | null) => void,
): () => void {
  void callback;
  return () => {};
}

function subscribeCrossWindowDragSourceResults(
  callback: (result: import("../../shared/cross-window-drag").CrossWindowDragSourceResult) => void,
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

export const browserRendererTransport = {
  kind: "browser" as const,
  async getOwnedBlockDocumentDescriptor(projectId: string, ownerBlockId: string) {
    const response = await fetch(
      toApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/blocks/${encodeURIComponent(ownerBlockId)}/document`,
      ),
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error(`Owned Document lookup failed with status ${response.status}`);
    }
    return decodeOwnedBlockDocumentDescriptorHttp(await response.text());
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
        return { ok: false as const, error: decodeDocumentHttpError(await response.text()) };
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
      value: decodeOwnedBlockDocumentDescriptorHttp(await response.text()),
    };
  },
  createDocumentSyncAdapter(projectId: string) {
    return createHttpDocumentSyncAdapter({ projectId });
  },
  invoke,
  subscribeBoardChanges,
  subscribeProjectSessionChanges,
  subscribeProjectChanges,
  subscribeCodexHostMessages,
  subscribeCodexRendererClientRequests,
  subscribeDesktopNotificationActions,
  subscribeGitBranchChanges,
  subscribeAppUpdateStatus,
  subscribeCommandKeymapChanges,
  subscribeCommandPaletteThreadIndexUpdates,
  subscribeCodexScheduledAutomationChanges,
  subscribeCodexAutomationRunsUpdates,
  subscribePersistedAtomUpdates,
  subscribeCrossWindowDragActiveChanges,
  subscribeCrossWindowDragSourceResults,
  getWindowFocusState,
  subscribeWindowFocusChanges,
};
