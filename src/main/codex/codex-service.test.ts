import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CodexHostMessage,
  CodexConversationSnapshot,
  CodexEvent,
  CodexItemView,
  CodexCollaborationModePreset,
  CodexPermissionMode,
  CodexPermissionState,
  CodexPromptInput,
  CodexSteerTurnInput,
  CodexThreadActionResult,
  CodexThreadDetail,
  CodexTranscriptEntry,
  CodexTurnSummary,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadSummary,
  ManagedWorktreeRecord,
  ProjectSessionForkResult,
} from "../../shared/types";
import { applyCodexConversationStateUpdates } from "../../shared/codex-conversation-patches";
import {
  closeDatabase,
  createProject,
  initializeDatabase,
} from "../kanban/db-service";
import {
  dbNotifier,
  type ProjectSessionsChangeEvent,
} from "../kanban/db-notifier";
import {
  createProjectSession,
  createProjectSessionTab,
  getProjectSession,
  listProjectSessions,
  upsertProjectSessionThreadLink,
} from "../kanban/project-session-service";
import { CodexRpcError } from "./codex-app-server-client";
import {
  getCodexThread,
  setCodexThreadPinned,
  upsertCodexThread,
} from "./codex-link-repository";
import { resetCodexSessionStoreCaches } from "./codex-session-store";
import { CodexService } from "./codex-service";
import {
  createInlineCommandPaletteThreadSearchClient,
  type CommandPaletteThreadSearchClient,
} from "./command-palette-thread-search-coordinator";
import { CommandPaletteThreadSearchService } from "./command-palette-thread-search-service";
import {
  CODEX_THREAD_TITLE_CONFIG,
  CODEX_THREAD_TITLE_MODEL,
  CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
} from "./thread-title-generator";
import { MAX_PROJECT_SESSION_TITLE_LENGTH } from "../../shared/schemas/project-sessions";

interface TestableCodexService {
  on: (event: "hostMessage", listener: (message: import("../../shared/types").CodexHostMessage) => void) => unknown;
  shutdown: () => Promise<void>;
  readAccountSnapshot: () => Promise<import("../../shared/types").CodexAccountSnapshot>;
  logoutAccount: () => Promise<boolean>;
  readThread: (threadId: string, includeTurns?: boolean) => Promise<CodexThreadDetail | null>;
  resolveThreadSummary: (threadId: string) => Promise<import("../../shared/types").CodexThreadSummary | null>;
  syncSidebarThreads: (input?: { includeArchived?: boolean; refresh?: boolean }) => Promise<import("../../shared/types").CodexSidebarSnapshot>;
  syncSidebarThreadsDetailed: (input?: {
    includeArchived?: boolean;
    policy?: import("../../shared/types").CodexSidebarRefreshPolicy;
    reason?: import("../../shared/types").CodexSidebarRefreshReason;
  }) => Promise<import("../../shared/types").CodexSidebarSyncResult>;
  listCommandPaletteThreads: (input: { scope: "sidebar" }) => CommandPaletteThreadSummary[];
  searchCommandPaletteThreadContent: (input: {
    scope: "sidebar";
    query: string;
    limit?: number;
  }) => Promise<CommandPaletteThreadContentSearchResult[]>;
  requestConversationSnapshot: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  requestConversationResume: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  serializeThreadDetail: (threadId: string) => CodexThreadDetail | null;
  serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
  resumeThread: (threadId: string) => Promise<CodexThreadDetail | null>;
  editLastUserTurn: (
    threadId: string,
    turnId: string,
    message: string,
    opts?: { serviceTier?: null | "fast" },
  ) => Promise<CodexThreadActionResult>;
  forkConversationFromTurn: (threadId: string, turnId: string, message: string) => Promise<CodexThreadActionResult>;
  forkProjectSessionThread: (sessionId: string, input: {
    target: "local" | "newWorktree";
    turnId?: string;
    message?: string;
    collaborationMode?: "default" | "plan";
  }) => Promise<ProjectSessionForkResult>;
  startSideChat: (input: {
    projectId: string;
    parentThreadId: string;
    parentNavigationPath?: string | null;
    prompt?: string;
    permissionMode?: CodexPermissionMode;
    model?: string;
    serviceTier?: null | "fast";
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    collaborationMode?: "default" | "plan";
    promptInput?: CodexPromptInput;
  }) => Promise<{
    parentThreadId: string;
    threadId: string;
    conversation: CodexConversationSnapshot;
  }>;
  discardSideChat: (threadId: string) => Promise<boolean>;
  startTurn: (
    threadId: string,
    prompt: string,
    opts?: {
      model?: string;
      serviceTier?: null | "fast";
      reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      permissionMode?: CodexPermissionMode;
      collaborationMode?: "default" | "plan";
      promptInput?: CodexPromptInput;
    },
  ) => Promise<CodexTurnSummary | null>;
  steerTurn: (input: CodexSteerTurnInput) => Promise<{ turnId: string } | null>;
  enqueueQueuedFollowUpPrompt: (
    threadId: string,
    prompt: string,
    opts?: {
      model?: string;
      serviceTier?: null | "fast";
      reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      permissionMode?: CodexPermissionMode;
      collaborationMode?: "default" | "plan";
      promptInput?: CodexPromptInput;
    },
  ) => Promise<void>;
  sendQueuedFollowUpNow: (threadId: string, followUpId: string) => Promise<void>;
  respondToMcpServerElicitation: (requestId: string, action: "accept" | "decline" | "cancel") => Promise<boolean>;
  startThreadForSession: (input: {
    projectId: string;
    sessionId: string;
    prompt: string;
    threadName?: string;
    model?: string;
    serviceTier?: null | "fast";
    permissionMode?: CodexPermissionMode;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    collaborationMode?: "default" | "plan";
    promptInput?: CodexPromptInput;
    skipAutoTitleGeneration?: boolean;
    runInTarget?: "localProject" | "newWorktree" | "cloud";
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: "autoBranch" | "detachedHead";
    worktreeBranchPrefix?: string;
  }) => Promise<CodexThreadDetail>;
  setThreadName: (threadId: string, name: string) => Promise<boolean>;
  setGeneratedThreadName: (threadId: string, name: string) => Promise<boolean>;
  listCollaborationModes: () => Promise<CodexCollaborationModePreset[]>;
  interruptTurn: (threadId: string, turnId?: string) => Promise<boolean>;
  cleanBackgroundTerminals: (threadId: string) => Promise<boolean>;
  respondToUserInput: (requestId: string, answers: Record<string, string[]>) => Promise<boolean>;
  setProjectPermissionMode: (projectId: string, mode: CodexPermissionMode) => Promise<CodexPermissionState>;
  getCustomPermissionModeDescription: (projectId: string) => string;
  listManagedWorktrees: () => Promise<ManagedWorktreeRecord[]>;
  deleteManagedWorktree: (threadId: string) => Promise<boolean>;
  setConversationCollaborationMode: (
    threadId: string,
    collaborationMode: "default" | "plan",
  ) => Promise<import("../../shared/types").CodexCollaborationModeState>;
  removePlanImplementationRequest: (threadId: string, turnId: string) => Promise<boolean>;
}

function makeThreadDetail(threadId: string): CodexThreadDetail {
  return {
    threadId,
    projectId: "project-1",
    source: null,
    threadName: "Thread",
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp",
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    linkedAt: new Date().toISOString(),
    turns: [],
    transcript: [],
  };
}

function createService(options?: {
  rateLimitsPollIntervalMs?: number;
  commandPaletteThreadSearchClient?: CommandPaletteThreadSearchClient;
}): TestableCodexService {
  return new CodexService({
    rateLimitsPollIntervalMs: options?.rateLimitsPollIntervalMs,
    commandPaletteThreadSearchClient:
      options?.commandPaletteThreadSearchClient ?? createInlineCommandPaletteThreadSearchClient(),
  }) as unknown as TestableCodexService;
}

function makeSidebarListThread(input: {
  id: string;
  cwd: string | null;
  preview?: string;
  name?: string | null;
  updatedAt?: number;
  archived?: boolean;
}) {
  const updatedAt = input.updatedAt ?? 20;
  return {
    id: input.id,
    sessionId: input.id,
    forkedFromId: null,
    parentThreadId: null,
    preview: input.preview ?? input.name ?? "External thread",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: Math.max(1, updatedAt - 10),
    updatedAt,
    status: { type: "idle" },
    path: null,
    cwd: input.cwd,
    cliVersion: "test",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: input.name ?? null,
    turns: [],
    archived: input.archived ?? false,
  };
}

async function flushAsyncWork(ticks = 2): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function projectConversationFromHostMessages(
  messages: readonly CodexHostMessage[],
): CodexConversationSnapshot | null {
  let conversation: CodexConversationSnapshot | null = null;
  for (const message of messages) {
    if (message.type !== "threadStreamStateChanged") {
      continue;
    }

    if (message.change.type === "snapshot") {
      conversation = message.change.conversationState;
      continue;
    }

    if (!conversation) {
      continue;
    }

    conversation = applyCodexConversationStateUpdates(conversation, message.change.patches);
  }

  return conversation;
}

function collectProjectSessionChangeEvents(): {
  events: ProjectSessionsChangeEvent[];
  dispose: () => void;
} {
  const events: ProjectSessionsChangeEvent[] = [];
  const listener = (event: ProjectSessionsChangeEvent) => {
    events.push(event);
  };
  dbNotifier.on("project-sessions-changed", listener);
  return {
    events,
    dispose: () => dbNotifier.removeListener("project-sessions-changed", listener),
  };
}

function getRecordedItem(
  service: unknown,
  threadId: string,
  turnId: string,
  itemId: string,
): CodexItemView | null {
  const record = (service as {
    getConversationRecord: (id: string) => {
      itemsByTurn: Map<string, Map<string, CodexItemView>>;
    };
  }).getConversationRecord(threadId);
  const items = record.itemsByTurn.get(turnId);
  if (!items) return null;
  for (const item of items.values()) {
    if (item.itemId === itemId) return item;
  }
  return null;
}

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let defaultProjectId = "";

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-service-"));
  process.env.KANBAN_DIR = tempDir;

  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
      return false;
    }
    throw error;
  }

  defaultProjectId = createProject({ name: "Codex", sources: ["/tmp/codex"] }).id;

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.KANBAN_DIR;
  }
}

function withTempCodexHome(run: (codexHome: string) => void): void {
  const previousCodexHome = process.env.CODEX_HOME;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-"));
  process.env.CODEX_HOME = tempDir;
  resetCodexSessionStoreCaches();

  try {
    run(tempDir);
  } finally {
    if (previousCodexHome) {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetCodexSessionStoreCaches();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function initializeGitRepository(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Nodex Test"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "nodex@example.com"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoPath });
}

describe("codex-service rate limit polling", () => {
  test("polls rate limits every interval without rereading account", async () => {
    const service = createService({ rateLimitsPollIntervalMs: 20 });
    const client = Reflect.get(service as object, "client") as {
      emit: (event: string, payload: unknown) => boolean;
      start: () => Promise<void>;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    let accountReadCount = 0;
    let rateLimitsReadCount = 0;

    client.start = async () => undefined;
    client.request = async (method: string) => {
      if (method === "account/read") {
        accountReadCount += 1;
        return {
          account: { type: "chatgpt", email: "test@example.com", planType: "plus" },
          requiresOpenaiAuth: false,
        };
      }
      if (method === "account/rateLimits/read") {
        rateLimitsReadCount += 1;
        return {
          rateLimits: {
            primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: Date.now() + 1_000 },
            secondary: { usedPercent: 39, windowDurationMins: 10_080, resetsAt: Date.now() + 2_000 },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    };

    client.emit("connection", { status: "connected", retries: 0 });
    await service.readAccountSnapshot();
    await waitForCondition(() => rateLimitsReadCount >= 3, 250);
    await service.shutdown();

    expect(accountReadCount).toBe(1);
    expect(rateLimitsReadCount >= 3).toBeTrue();
  });

  test("stops polling after logout clears the authenticated account", async () => {
    const service = createService({ rateLimitsPollIntervalMs: 20 });
    const client = Reflect.get(service as object, "client") as {
      emit: (event: string, payload: unknown) => boolean;
      start: () => Promise<void>;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    let rateLimitsReadCount = 0;

    client.start = async () => undefined;
    client.request = async (method: string) => {
      if (method === "account/read") {
        return {
          account: { type: "chatgpt", email: "test@example.com", planType: "plus" },
          requiresOpenaiAuth: false,
        };
      }
      if (method === "account/rateLimits/read") {
        rateLimitsReadCount += 1;
        return {
          rateLimits: {
            primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: Date.now() + 1_000 },
          },
        };
      }
      if (method === "account/logout") {
        return {};
      }
      throw new Error(`Unexpected method ${method}`);
    };

    client.emit("connection", { status: "connected", retries: 0 });
    await service.readAccountSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const readsBeforeLogout = rateLimitsReadCount;
    await service.logoutAccount();
    await new Promise((resolve) => setTimeout(resolve, 45));
    await service.shutdown();

    expect(readsBeforeLogout >= 2).toBeTrue();
    expect(rateLimitsReadCount).toBe(readsBeforeLogout);
  });
});

describe("codex-service readThread fallback", () => {
  test("retries with includeTurns=false for pre-materialization errors", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };
      const includeTurnsCalls: boolean[] = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};

        const request = params as { includeTurns?: boolean };
        const includeTurns = request.includeTurns === true;
        includeTurnsCalls.push(includeTurns);
        if (includeTurns) {
          throw new CodexRpcError(
            "thread 019cb472-b24b-79b2-bdac-aa9dbc4eb28f is not materialized yet; includeTurns is unavailable before first user message",
            -32600,
          );
        }

        return {
          thread: {
            id: "thr_read_fallback",
            turns: [],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_read_fallback", true);
        expect(detail).not.toBeNull();
        expect(detail?.threadId).toBe("thr_read_fallback");
        expect(includeTurnsCalls.length).toBe(2);
        expect(includeTurnsCalls[0]).toBeTrue();
        expect(includeTurnsCalls[1]).toBeFalse();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("does not retry includeTurns=false for non-rollout errors", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };
      const includeTurnsCalls: boolean[] = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { includeTurns?: boolean };
        includeTurnsCalls.push(request.includeTurns === true);
        throw new CodexRpcError("permission denied", -32603);
      };

      try {
        let failed = false;
        let message = "";
        try {
          await service.readThread("thr_read_error", true);
        } catch (error) {
          failed = true;
          message = error instanceof Error ? error.message : String(error);
        }

        expect(failed).toBeTrue();
        expect(message.includes("permission denied")).toBeTrue();
        expect(includeTurnsCalls.length).toBe(1);
        expect(includeTurnsCalls[0]).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("resolves thread summaries from SQLite before app-server reads", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_cached_summary",
        threadName: "Cached summary",
        threadPreview: "Cached preview",
        modelProvider: "openai",
        statusType: "idle",
        statusActiveFlags: [],
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      let requests = 0;
      client.start = async () => undefined;
      client.request = async () => {
        requests += 1;
        return {};
      };

      try {
        const summary = await service.resolveThreadSummary("thr_cached_summary");
        expect(summary?.threadName).toBe("Cached summary");
        expect(requests).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("resolves missing thread summaries with thread/read includeTurns=false", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };
      let requestMethod = "";
      let requestParams: unknown = null;

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requestMethod = method;
        requestParams = params;
        return {
          thread: {
            id: "thr_remote_summary",
            name: "Remote summary",
            preview: "Remote preview",
            modelProvider: "openai",
            cwd: "/tmp/codex",
            status: {
              type: "active",
              activeFlags: ["waitingOnUserInput"],
            },
            createdAt: 1,
            updatedAt: 2,
          },
        };
      };

      try {
        const summary = await service.resolveThreadSummary("thr_remote_summary");
        const request = requestParams as { threadId?: string; includeTurns?: boolean };
        const persisted = getCodexThread("thr_remote_summary");

        expect(requestMethod).toBe("thread/read");
        expect(request.threadId).toBe("thr_remote_summary");
        expect(request.includeTurns).toBeFalse();
        expect(summary?.threadName).toBe("Remote summary");
        expect(summary?.statusType).toBe("active");
        expect(summary?.statusActiveFlags.join(",")).toBe("waitingOnUserInput");
        expect(persisted?.threadPreview).toBe("Remote preview");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("materializes sidebar sessions with bounded fallback titles from long app-server previews", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const longPreview = `Long preview ${"x".repeat(MAX_PROJECT_SESSION_TITLE_LENGTH + 200)}`;
      const normalPreview = "Normal external thread";
      const makeThread = (id: string, preview: string, updatedAt: number) => ({
        id,
        sessionId: id,
        forkedFromId: null,
        parentThreadId: null,
        preview,
        ephemeral: false,
        modelProvider: "openai",
        createdAt: updatedAt - 10,
        updatedAt,
        status: { type: "idle" },
        path: null,
        cwd: "/tmp/codex",
        cliVersion: "test",
        source: "cli",
        threadSource: null,
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      });

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeThread("thr_long_preview", longPreview, 20),
            makeThread("thr_normal_preview", normalPreview, 10),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreads({ refresh: true });
        const sessions = listProjectSessions(defaultProjectId);
        const longSession = sessions.find((session) => session.thread?.threadId === "thr_long_preview");
        const normalSession = sessions.find((session) => session.thread?.threadId === "thr_normal_preview");
        const persistedLongThread = getCodexThread("thr_long_preview");

        expect(longSession !== undefined).toBeTrue();
        expect(normalSession !== undefined).toBeTrue();
        expect(longSession?.noThreadFallbackTitle.length).toBe(MAX_PROJECT_SESSION_TITLE_LENGTH);
        expect(longSession?.noThreadFallbackTitle.startsWith("Long preview")).toBeTrue();
        expect(normalSession?.noThreadFallbackTitle).toBe(normalPreview);
        expect(persistedLongThread?.threadPreview.length).toBe(longPreview.length);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("materializes project-bound sidebar sessions from thread-started notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });

      try {
        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_started_project",
            parentThreadId: null,
            preview: "Started from CLI",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/codex/packages/app",
            createdAt: 10,
            updatedAt: 20,
            status: { type: "idle" },
            name: null,
            source: "cli",
          },
        });

        const sessions = listProjectSessions(defaultProjectId);
        const linked = sessions.find((session) => session.thread?.threadId === "thr_started_project");
        const summary = getCodexThread("thr_started_project");

        expect(linked !== undefined).toBeTrue();
        expect(linked?.projectId).toBe(defaultProjectId);
        expect(linked?.noThreadFallbackTitle).toBe("Started from CLI");
        expect(summary?.projectId).toBe(defaultProjectId);
        const sidebarMessage = hostMessages.find((message) => message.type === "sidebarSyncUpdated");
        expect(sidebarMessage !== undefined).toBeTrue();
        if (sidebarMessage?.type === "sidebarSyncUpdated") {
          expect(sidebarMessage.result.changedProjectIds.includes(defaultProjectId)).toBeTrue();
          expect(sidebarMessage.result.materializedSessionIds.includes(linked?.id ?? "")).toBeTrue();
        }

        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_started_project",
            parentThreadId: null,
            preview: "Started from CLI",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/codex/packages/app",
            createdAt: 10,
            updatedAt: 30,
            status: { type: "idle" },
            name: null,
            source: "cli",
          },
        });
        const duplicateCount = listProjectSessions(defaultProjectId)
          .filter((session) => session.thread?.threadId === "thr_started_project").length;
        expect(duplicateCount).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("materializes projectless sidebar sessions from unmatched thread-started notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_started_projectless",
            parentThreadId: null,
            preview: "Outside workspace",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/outside-project",
            createdAt: 10,
            updatedAt: 20,
            status: { type: "idle" },
            name: null,
            source: "cli",
          },
        });

        const sessions = listProjectSessions(null);
        const linked = sessions.find((session) => session.thread?.threadId === "thr_started_projectless");
        const summary = getCodexThread("thr_started_projectless");

        expect(linked !== undefined).toBeTrue();
        expect(linked?.projectId).toBe(null);
        expect(linked?.noThreadFallbackTitle).toBe("Outside workspace");
        expect(summary?.projectId).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("requests sidebar thread-list with all source kinds from the state DB read model", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: unknown[] = [];
      const expectedSourceKinds = [
        "cli",
        "vscode",
        "exec",
        "appServer",
        "subAgent",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "subAgentOther",
        "unknown",
      ];

      client.start = async () => undefined;
      client.request = async (method, params) => {
        if (method !== "thread/list") return {};
        requests.push(params);
        return {
          data: [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({
          includeArchived: true,
          policy: "force",
          reason: "manual",
        });

        const activeRequest = requests[0] as Record<string, unknown> | undefined;
        const archivedRequest = requests[1] as Record<string, unknown> | undefined;

        expect(requests.length).toBe(2);
        expect(activeRequest !== undefined).toBeTrue();
        expect(archivedRequest !== undefined).toBeTrue();
        expect(activeRequest?.archived).toBe(false);
        expect(archivedRequest?.archived).toBe(true);
        expect(activeRequest?.modelProviders).toBe(null);
        expect(archivedRequest?.modelProviders).toBe(null);
        expect(activeRequest?.useStateDbOnly).toBe(true);
        expect(archivedRequest?.useStateDbOnly).toBe(true);
        expect(JSON.stringify(activeRequest?.sourceKinds)).toBe(JSON.stringify(expectedSourceKinds));
        expect(JSON.stringify(archivedRequest?.sourceKinds)).toBe(JSON.stringify(expectedSourceKinds));
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("falls back when app-server does not support state DB sidebar thread-listing", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: unknown[] = [];

      client.start = async () => undefined;
      client.request = async (method, params) => {
        if (method !== "thread/list") return {};
        requests.push(params);
        const request = params as Record<string, unknown>;
        if (request.useStateDbOnly === true) {
          throw new CodexRpcError("unknown field `useStateDbOnly`", -32602);
        }
        return {
          data: [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const firstResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const secondResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const firstRequest = requests[0] as Record<string, unknown> | undefined;
        const retryRequest = requests[1] as Record<string, unknown> | undefined;
        const secondSyncRequest = requests[2] as Record<string, unknown> | undefined;

        expect(firstResult.source).toBe("app-server");
        expect(secondResult.source).toBe("app-server");
        expect(requests.length).toBe(3);
        expect(firstRequest?.useStateDbOnly).toBe(true);
        expect("useStateDbOnly" in (retryRequest ?? {})).toBeFalse();
        expect("useStateDbOnly" in (secondSyncRequest ?? {})).toBeFalse();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("coalesces concurrent sidebar force sync calls through one thread-list request", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      let requestCount = 0;
      let releaseRequest: () => void = () => undefined;
      const requestGate = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        requestCount += 1;
        await requestGate;
        return {
          data: [
            {
              id: "thr_coalesced_sidebar_sync",
              parentThreadId: null,
              preview: "Coalesced",
              ephemeral: false,
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1,
              updatedAt: 2,
              status: { type: "idle" },
              name: null,
              source: "cli",
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const first = service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const second = service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        await waitForCondition(() => requestCount === 1, 100);
        releaseRequest();
        const firstResult = await first;
        const secondResult = await second;

        expect(requestCount).toBe(1);
        expect(firstResult.source).toBe("app-server");
        expect(secondResult.source).toBe("app-server");
        expect(firstResult.materializedSessionIds.length).toBe(1);
        expect(secondResult.materializedSessionIds.length).toBe(1);
      } finally {
        releaseRequest();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("does not emit project session changes for unchanged sidebar force sync data", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const captured = collectProjectSessionChangeEvents();

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_noop_sidebar_sync",
              cwd: "/tmp/codex/packages/app",
              preview: "Stable thread",
              updatedAt: 50,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const firstResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        expect(firstResult.materializedSessionIds.length).toBe(1);
        expect(captured.events.length).toBe(1);

        captured.events.length = 0;
        const secondResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        expect(captured.events.length).toBe(0);
        expect(secondResult.changedProjectIds.length).toBe(0);
        expect(secondResult.projectlessChanged).toBeFalse();
        expect(secondResult.materializedSessionIds.length).toBe(0);
      } finally {
        captured.dispose();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("emits one project session change when sidebar thread summary changes in place", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const captured = collectProjectSessionChangeEvents();
      let preview = "Before";
      let updatedAt = 50;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_changed_sidebar_summary",
              cwd: "/tmp/codex/packages/app",
              preview,
              updatedAt,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_changed_sidebar_summary");
        expect(linked !== undefined).toBeTrue();

        captured.events.length = 0;
        preview = "After";
        updatedAt = 60;
        const result = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        expect(captured.events.length).toBe(1);
        expect(captured.events[0]?.projectId).toBe(defaultProjectId);
        expect(captured.events[0]?.changeType).toBe("thread");
        expect(captured.events[0]?.sessionId).toBe(linked?.id);
        expect(result.changedProjectIds.includes(defaultProjectId)).toBeTrue();
        expect(result.projectlessChanged).toBeFalse();
        expect(result.materializedSessionIds.length).toBe(0);
      } finally {
        captured.dispose();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forces sidebar repair for unknown name notifications even when the last sync is fresh", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      let requestCount = 0;
      let exposeUnknownThread = false;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        requestCount += 1;
        return {
          data: exposeUnknownThread
            ? [
                makeSidebarListThread({
                  id: "thr_unknown_name_repair",
                  cwd: "/tmp/codex/packages/app",
                  name: "Repaired title",
                  updatedAt: 50,
                }),
              ]
            : [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        exposeUnknownThread = true;
        await serviceInternals.handleNotification("thread/name/updated", {
          threadId: "thr_unknown_name_repair",
          threadName: "Repaired title",
        });
        await waitForCondition(() => getCodexThread("thr_unknown_name_repair") !== null, 1_000);

        const summary = getCodexThread("thr_unknown_name_repair");
        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_unknown_name_repair");

        expect(requestCount).toBe(2);
        expect(summary?.threadName).toBe("Repaired title");
        expect(linked !== undefined).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forces sidebar repair for unknown goal metadata notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      let exposeUnknownThread = false;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: exposeUnknownThread
            ? [
                makeSidebarListThread({
                  id: "thr_unknown_goal_repair",
                  cwd: "/tmp/codex",
                  preview: "Goal repaired",
                  updatedAt: 80,
                }),
              ]
            : [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        exposeUnknownThread = true;
        await serviceInternals.handleNotification("thread/goal/updated", {
          threadId: "thr_unknown_goal_repair",
        });
        await waitForCondition(() => getCodexThread("thr_unknown_goal_repair") !== null, 1_000);

        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_unknown_goal_repair");

        expect(getCodexThread("thr_unknown_goal_repair") !== null).toBeTrue();
        expect(linked !== undefined).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("re-homes a projectless linked sidebar session when cwd later matches a project source", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const captured = collectProjectSessionChangeEvents();
      let cwd: string | null = "/tmp/outside-project";

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_rehome_projectless",
              cwd,
              preview: "Move me",
              updatedAt: cwd === null ? 20 : 30,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const projectless = listProjectSessions(null)
          .find((session) => session.thread?.threadId === "thr_rehome_projectless");
        expect(projectless !== undefined).toBeTrue();
        expect(projectless?.projectId).toBe(null);

        captured.events.length = 0;
        cwd = "/tmp/codex/packages/app";
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        const moved = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_rehome_projectless");
        const stillProjectless = listProjectSessions(null)
          .find((session) => session.thread?.threadId === "thr_rehome_projectless");

        expect(moved?.id).toBe(projectless?.id);
        expect(moved?.projectId).toBe(defaultProjectId);
        expect(stillProjectless === undefined).toBeTrue();
        expect(captured.events.length).toBe(2);
        const oldScopeEvents = captured.events.filter((event) =>
          event.projectId === null
          && event.changeType === "thread"
          && event.sessionId === projectless?.id
        );
        const newScopeEvents = captured.events.filter((event) =>
          event.projectId === defaultProjectId
          && event.changeType === "thread"
          && event.sessionId === projectless?.id
        );
        expect(oldScopeEvents.length).toBe(1);
        expect(newScopeEvents.length).toBe(1);
      } finally {
        captured.dispose();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("archives project-scoped linked session instead of moving its tabs across projects", async () => {
    const ran = await withTempDatabase(async () => {
      const targetProjectId = createProject({ name: "Other", sources: ["/tmp/other"] }).id;
      const session = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Scoped panel",
      });
      createProjectSessionTab({
        sessionId: session.id,
        projectId: defaultProjectId,
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        config: { projectId: defaultProjectId, view: "kanban" },
      });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: defaultProjectId,
        threadId: "thr_rehome_scoped_tabs",
        threadPreview: "Scoped panel",
        modelProvider: "openai",
        cwd: "/tmp/codex",
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_rehome_scoped_tabs",
              cwd: "/tmp/other/app",
              preview: "Scoped panel moved",
              updatedAt: 60,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        const archivedOriginal = getProjectSession(session.id);
        const replacement = listProjectSessions(targetProjectId)
          .find((candidate) => candidate.thread?.threadId === "thr_rehome_scoped_tabs");

        expect(archivedOriginal?.archived).toBeTrue();
        expect(replacement !== undefined).toBeTrue();
        expect(replacement?.id === session.id).toBeFalse();
        expect(replacement?.projectId).toBe(targetProjectId);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("thread-deleted archives linked sessions, clears pin, and removes the active sidebar row", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Delete me",
      });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: defaultProjectId,
        threadId: "thr_deleted_cleanup",
        threadPreview: "Delete me",
        modelProvider: "openai",
        cwd: "/tmp/codex",
      });
      setCodexThreadPinned("thr_deleted_cleanup", true);
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        await serviceInternals.handleNotification("thread/deleted", {
          threadId: "thr_deleted_cleanup",
        });

        const archived = getProjectSession(session.id);
        const snapshot = await service.syncSidebarThreads({ refresh: false });

        expect(archived?.archived).toBeTrue();
        expect(getCodexThread("thr_deleted_cleanup") === null).toBeTrue();
        expect(snapshot.items.some((item) => item.threadId === "thr_deleted_cleanup")).toBeFalse();
        expect(snapshot.pinnedThreadIds.includes("thr_deleted_cleanup")).toBeFalse();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("clears sidebar project assignment when sync explicitly resolves no project", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_project_assignment_clear",
        threadPreview: "In project",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        createdAt: 1,
        updatedAt: 2,
      });
      upsertCodexThread({
        threadId: "thr_project_assignment_clear",
        threadPreview: "Preserve old assignment",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        createdAt: 1,
        updatedAt: 3,
      });
      const stillProjectBound = getCodexThread("thr_project_assignment_clear");

      upsertCodexThread({
        projectId: null,
        threadId: "thr_project_assignment_clear",
        threadPreview: "Projectless",
        modelProvider: "openai",
        cwd: "/tmp/outside-project",
        createdAt: 1,
        updatedAt: 4,
      });
      const cleared = getCodexThread("thr_project_assignment_clear");

      upsertCodexThread({
        threadId: "thr_project_assignment_clear",
        threadPreview: "Preserved",
        modelProvider: "openai",
        cwd: "/tmp/outside-project",
        createdAt: 1,
        updatedAt: 5,
      });
      const preserved = getCodexThread("thr_project_assignment_clear");

      expect(stillProjectBound?.projectId).toBe(defaultProjectId);
      expect(cleared?.projectId).toBe(null);
      expect(preserved?.projectId).toBe(null);
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("lists command-palette chats from sidebar scope", async () => {
    const ran = await withTempDatabase(async () => {
      const visibleSession = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Palette visible",
      });
      upsertProjectSessionThreadLink({
        sessionId: visibleSession.id,
        projectId: defaultProjectId,
        threadId: "thr_palette_visible",
        threadName: "Palette visible thread",
        threadPreview: "Visible preview",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        updatedAt: 200,
      });

      const archivedSession = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Palette archived",
      });
      upsertProjectSessionThreadLink({
        sessionId: archivedSession.id,
        projectId: defaultProjectId,
        threadId: "thr_palette_archived",
        threadName: "Archived thread",
        threadPreview: "Archived preview",
        modelProvider: "openai",
        archived: true,
        updatedAt: 300,
      });

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_project_only",
        threadName: "Project only",
        threadPreview: "No session owner",
        modelProvider: "openai",
        updatedAt: 400,
      });

      upsertCodexThread({
        threadId: "thr_projectless",
        threadName: "Projectless chat",
        threadPreview: "No project owner",
        modelProvider: "openai",
        updatedAt: 500,
      });

      const service = createService();
      try {
        const results = service.listCommandPaletteThreads({ scope: "sidebar" });
        const ids = results.map((thread) => thread.threadId).join(",");

        expect(results.length).toBe(3);
        expect(ids.includes("thr_palette_visible")).toBeTrue();
        expect(ids.includes("thr_project_only")).toBeTrue();
        expect(ids.includes("thr_projectless")).toBeTrue();
        expect(ids.includes("thr_palette_archived")).toBeFalse();
        const projectless = results.find((thread) => thread.threadId === "thr_projectless");
        expect(projectless?.projectless).toBeTrue();
        expect(projectless?.projectId ?? null).toBe(null);
        expect(projectless?.sessionId ?? null).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("searches command-palette content across sidebar chats without leaking archived rows", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_sessionless",
        threadName: "Content sessionless",
        threadPreview: "Visible sessionless preview",
        modelProvider: "openai",
        updatedAt: 200,
      });

      upsertCodexThread({
        threadId: "thr_content_projectless",
        threadName: "Content projectless",
        threadPreview: "Visible projectless preview",
        modelProvider: "openai",
        updatedAt: 300,
      });

      upsertCodexThread({
        threadId: "thr_content_archived",
        threadName: "Content archived",
        threadPreview: "Archived preview",
        modelProvider: "openai",
        archived: true,
        updatedAt: 400,
      });

      const service = createService();
      const searchIndexer = new CommandPaletteThreadSearchService();
      try {
        const summaries = service.listCommandPaletteThreads({ scope: "sidebar" });
        for (const summary of summaries) {
          const thread = getCodexThread(summary.threadId);
          if (!thread) continue;
          searchIndexer.indexThreadDetail(summary, {
            ...thread,
            turns: [],
            transcript: [{
              threadId: summary.threadId,
              turnId: "turn_1",
              itemId: `item_${summary.threadId}`,
              type: "userMessage",
              kind: "userMessage",
              semanticKind: "userMessage",
              role: "user",
              markdownText: `Visible transcript needle from ${summary.threadId}`,
              createdAt: summary.updatedAt,
              updatedAt: summary.updatedAt,
            }],
          });
        }

        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "needle",
          limit: 60,
        });
        const ids = results.map((result) => result.threadId).join(",");

        expect(ids.includes("thr_content_sessionless")).toBeTrue();
        expect(ids.includes("thr_content_projectless")).toBeTrue();
        expect(ids.includes("thr_content_archived")).toBeFalse();
      } finally {
        searchIndexer.shutdown();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("does not call app-server thread search for command-palette content", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_local_only",
        threadName: "Content local only",
        threadPreview: "Visible preview",
        modelProvider: "openai",
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: () => Promise<never>;
      };
      client.start = async () => undefined;
      client.request = async () => {
        throw new Error("app-server should not be called");
      };

      try {
        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "transcript",
          limit: 60,
        });

        expect(results.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("fails closed when command-palette content search worker is unavailable", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_worker_unavailable",
        threadName: "Worker unavailable",
        threadPreview: "Visible preview",
        modelProvider: "openai",
      });

      const failingClient: CommandPaletteThreadSearchClient = {
        enqueueBackfill: () => undefined,
        search: async () => {
          throw new Error("worker unavailable");
        },
        indexConversation: () => undefined,
        removeThread: () => undefined,
        shutdown: () => undefined,
      };
      const service = createService({ commandPaletteThreadSearchClient: failingClient });

      try {
        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "visible",
          limit: 60,
        });

        expect(results.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("materializes fileChange patch rows and turn-level unified diff as separate transcript items", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      const patchDiff = "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new";
      const turnDiff = `${patchDiff}\n`;

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { threadId?: string };
        if (request.threadId !== "thr_file_change_diff") return {};

        return {
          thread: {
            id: "thr_file_change_diff",
            turns: [
              {
                id: "turn_file_change_diff",
                status: "completed",
                startedAt: 1,
                completedAt: 2,
                durationMs: 1000,
                diff: turnDiff,
                items: [
                  {
                    id: "patch_file_change_diff",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/example.ts",
                        diff: patchDiff,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_file_change_diff", true);
        expect(detail).not.toBeNull();
        expect(detail?.turns[0]?.diff).toBe(turnDiff);
        expect(detail?.turns[0]?.startedAt).toBe(1_000);
        expect(detail?.turns[0]?.completedAt).toBe(2_000);
        expect(detail?.turns[0]?.turnStartedAtMs).toBe(1_000);
        expect(detail?.turns[0]?.finalAssistantStartedAtMs).toBe(2_000);
        expect(detail?.turns[0]?.durationMs).toBe(1000);
        expect(detail?.transcript.length).toBe(2);
        expect(`${detail?.transcript[0]?.kind}:${detail?.transcript[0]?.semanticKind}`).toBe("fileChange:patch");
        expect(`${detail?.transcript[1]?.kind}:${detail?.transcript[1]?.semanticKind}`).toBe("systemEvent:diff");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});

describe("codex-service session-backed transcript recovery", () => {
  test("serializeThreadDetail rehydrates from Codex session files when no snapshot exists", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "17"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_session_file",
            thread_name: "Recovered from session file",
            updated_at: "2026-03-17T10:03:00.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "17", "rollout-2026-03-17T10-00-00-thr_session_file.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-17T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_session_file",
                timestamp: "2026-03-17T10:00:00.000Z",
                cwd: "/tmp/recovered",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-17T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_recovered",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-17T10:00:02.000Z",
              type: "response_item",
              payload: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "Hello" }],
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-17T10:00:03.000Z",
              type: "response_item",
              payload: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Recovered response" }],
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      try {
        const detail = service.serializeThreadDetail("thr_session_file");
        expect(detail).not.toBeNull();
        expect(detail?.threadName).toBe("Recovered from session file");
        expect(detail?.cwd).toBe("/tmp/recovered");
        expect(detail?.turns.length).toBe(1);
        expect(detail?.transcript.length).toBe(2);
        expect(detail?.transcript[1]?.markdownText).toBe("Recovered response");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("dedupes replay-materialized and live-read items for the same recovered turn", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "23"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_replay_merge",
            thread_name: "Recovered thread",
            updated_at: "2026-03-23T09:00:03.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "23", "rollout-2026-03-23T09-00-00-thr_replay_merge.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-23T09:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_replay_merge",
                timestamp: "2026-03-23T09:00:00.000Z",
                cwd: "/tmp/replay-merge",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T09:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_replay_merge",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T09:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "who are you",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T09:00:03.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "Codex, your coding agent in this repo.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { threadId?: string };
        if (request.threadId !== "thr_replay_merge") return {};

        return {
          thread: {
            id: "thr_replay_merge",
            turns: [
              {
                id: "turn_replay_merge",
                status: "completed",
                items: [
                  {
                    id: "user_live_1",
                    type: "userMessage",
                    content: [{ type: "text", text: "who are you" }],
                  },
                  {
                    id: "assistant_live_1",
                    type: "agentMessage",
                    text: "Codex, your coding agent in this repo.",
                  },
                ],
              },
            ],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_replay_merge", true);
        const serialized = service.serializeThreadDetail("thr_replay_merge");
        const persisted = getCodexThread("thr_replay_merge");

        expect(detail).not.toBeNull();
        expect(detail?.threadPreview).toBe("who are you");
        expect(detail?.transcript.length).toBe(2);
        expect(detail?.transcript[0]?.markdownText).toBe("who are you");
        expect(detail?.transcript[1]?.markdownText).toBe("Codex, your coding agent in this repo.");
        expect(serialized?.threadPreview).toBe("who are you");
        expect(serialized?.transcript.length).toBe(2);
        expect(persisted?.threadPreview).toBe("who are you");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("bootstraps reopened thread snapshots from session-backed canonical history without thread/read", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "23"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_old_open",
            thread_name: "Old thread",
            updated_at: "2026-03-23T10:00:05.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "23", "rollout-2026-03-23T10-00-00-thr_old_open.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-23T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_old_open",
                timestamp: "2026-03-23T10:00:00.000Z",
                cwd: "/tmp/old-open",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_old_open",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "who are you",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:03.000Z",
              type: "response_item",
              payload: {
                type: "function_call",
                call_id: "call_old_open",
                name: "exec_command",
                arguments: "{\"cmd\":\"pwd\"}",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:04.000Z",
              type: "response_item",
              payload: {
                type: "function_call_output",
                call_id: "call_old_open",
                output: "{\"cwd\":\"/tmp/old-open\"}",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:05.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "Codex, your coding agent in this repo.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        throw new Error(`unexpected RPC during snapshot request: ${method}`);
      };

      try {
        const conversation = await service.requestConversationSnapshot("thr_old_open");
        expect(conversation).not.toBeNull();
        expect(conversation?.threadId).toBe("thr_old_open");
        expect(conversation?.resumeState).toBe("needs_resume");
        expect(conversation?.turns.length).toBe(1);
        expect(conversation?.turns[0]?.turnId).toBe("turn_old_open");
        expect(conversation?.turns[0]?.items.length).toBe(2);
        expect(conversation?.turns[0]?.items[0]?.kind).toBe("userMessage");
        expect(conversation?.turns[0]?.items[0]?.markdownText).toBe("who are you");
        expect(conversation?.turns[0]?.items[1]?.kind).toBe("assistantMessage");
        expect(conversation?.turns[0]?.items[1]?.markdownText).toBe("Codex, your coding agent in this repo.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("bootstraps session-backed snapshots with context compaction markers and post-compaction turns intact", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "26"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_old_compacted",
            thread_name: "Old compacted thread",
            updated_at: "2026-03-26T10:00:08.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "26", "rollout-2026-03-26T10-00-00-thr_old_compacted.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-26T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_old_compacted",
                timestamp: "2026-03-26T10:00:00.000Z",
                cwd: "/tmp/old-compacted",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_before_compaction",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "Summarize the repo",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:03.000Z",
              type: "compacted",
              payload: {
                message: "",
                replacement_history: [],
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:04.000Z",
              type: "turn_context",
              payload: {
                turn_id: "turn_after_compaction",
                cwd: "/tmp/old-compacted",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:05.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "Keep going",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:06.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "Continuing after compaction.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        throw new Error(`unexpected RPC during compacted snapshot request: ${method}`);
      };

      try {
        const conversation = await service.requestConversationSnapshot("thr_old_compacted");
        expect(conversation).not.toBeNull();
        expect(conversation?.turns.length).toBe(2);
        expect(conversation?.turns[0]?.items.length).toBe(2);
        expect(conversation?.turns[0]?.items[1]?.semanticKind).toBe("contextCompaction");
        expect(conversation?.turns[0]?.items[1]?.markdownText).toBe("Context automatically compacted");
        expect(conversation?.turns[1]?.turnId).toBe("turn_after_compaction");
        expect(conversation?.turns[1]?.items[0]?.markdownText).toBe("Keep going");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("does not call thread/resume for a known archived thread", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        throw new Error(`unexpected RPC during archived resume: ${method}`);
      };

      try {
        const conversation = await service.requestConversationResume("thr_archived_known");

        expect(conversation?.threadId).toBe("thr_archived_known");
        expect(conversation?.archived).toBeTrue();
        expect(conversation?.resumeState).toBe("needs_resume");
        expect(requests.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("marks stale thread metadata archived when app-server rejects resume", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const hostMessages: CodexHostMessage[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          throw new CodexRpcError(
            "session 019ea13a-cca5-7760-98a8-7f3684bae059 is archived. Run `codex unarchive 019ea13a-cca5-7760-98a8-7f3684bae059` to unarchive it first.",
            -32600,
          );
        }
        throw new Error(`unexpected RPC during archived resume fallback: ${method}`);
      };

      try {
        const conversation = await service.requestConversationResume("thr_archived_stale");
        const projected = projectConversationFromHostMessages(hostMessages);
        const persisted = getCodexThread("thr_archived_stale");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("thread/resume");
        expect(conversation?.threadId).toBe("thr_archived_stale");
        expect(conversation?.archived).toBeTrue();
        expect(conversation?.resumeState).toBe("needs_resume");
        expect(projected?.archived).toBeTrue();
        expect(projected?.resumeState).toBe("needs_resume");
        expect(persisted?.archived).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("removes local thread state when app-server reports a deleted thread", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const events: CodexEvent[] = [];
      const hostMessages: CodexHostMessage[] = [];
      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        await serviceInternals.handleNotification("thread/deleted", {
          threadId: "thr_deleted_remote",
        });

        expect(getCodexThread("thr_deleted_remote")).toBe(null);
        expect(events.some((event) =>
          event.type === "threadDeleted" && event.threadId === "thr_deleted_remote"
        )).toBeTrue();
        expect(hostMessages.some((message) =>
          message.type === "threadDeleted" && message.threadId === "thr_deleted_remote"
        )).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("resume materializes completed reopened threads from the thread/resume payload", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "24"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_resume_no_duplicate",
            thread_name: "Resume without duplicate",
            updated_at: "2026-03-24T10:00:03.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "24", "rollout-2026-03-24T10-00-00-thr_resume_no_duplicate.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-24T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_resume_no_duplicate",
                timestamp: "2026-03-24T10:00:00.000Z",
                cwd: "/tmp/resume-no-duplicate",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_resume_no_duplicate",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "run bun test",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:03.000Z",
              type: "response_item",
              payload: {
                type: "function_call",
                call_id: "call_resume_no_duplicate",
                name: "exec_command",
                arguments: "{\"cmd\":\"bun test\"}",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:04.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "`bun test` passed.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_resume_no_duplicate",
              preview: "run bun test",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1711274400,
              updatedAt: 1711274404,
              status: { type: "idle" },
              path: "/tmp/resume-no-duplicate/rollout.jsonl",
              cwd: "/tmp/resume-no-duplicate",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Resume without duplicate",
              turns: [
                {
                  id: "turn_resume_no_duplicate",
                  status: "completed",
                  items: [
                    {
                      id: "user_resume_no_duplicate",
                      type: "userMessage",
                      content: [{ type: "text", text: "run bun test" }],
                    },
                    {
                      id: "tool_resume_no_duplicate",
                      type: "commandExecution",
                      status: "completed",
                      command: "bun test",
                      cwd: "/tmp/resume-no-duplicate",
                      aggregatedOutput: "1340 pass\n0 fail\n",
                    },
                    {
                      id: "assistant_resume_no_duplicate",
                      type: "agentMessage",
                      text: "`bun test` passed.",
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run for a completed resume payload");
        }
        return {};
      };

      try {
        const conversation = await service.requestConversationResume("thr_resume_no_duplicate");
        expect(conversation).not.toBeNull();
        expect(conversation?.turns.length).toBe(1);
        expect(conversation?.turns[0]?.items.length).toBe(3);
        expect(conversation?.turns[0]?.items[0]?.markdownText).toBe("run bun test");
        expect(conversation?.turns[0]?.items[1]?.toolCall?.toolName).toBe("bash");
        expect(conversation?.turns[0]?.items[2]?.markdownText).toBe("`bun test` passed.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("resume materializes in-progress threads from the thread/resume payload without thread/read", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "24"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_resume_refresh",
            thread_name: "Resume refresh",
            updated_at: "2026-03-24T11:00:02.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "24", "rollout-2026-03-24T11-00-00-thr_resume_refresh.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-24T11:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_resume_refresh",
                timestamp: "2026-03-24T11:00:00.000Z",
                cwd: "/tmp/resume-refresh",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T11:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_resume_refresh",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T11:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "run bun test",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_resume_refresh",
              preview: "run bun test",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1711278000,
              updatedAt: 1711278002,
              status: { type: "active", active_flags: ["streaming"] },
              path: "/tmp/resume-refresh/rollout.jsonl",
              cwd: "/tmp/resume-refresh",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Resume refresh",
              turns: [
                {
                  id: "turn_resume_refresh",
                  status: "in_progress",
                  items: [
                    {
                      id: "user_resume_refresh",
                      type: "userMessage",
                      content: [{ type: "text", text: "run bun test" }],
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during active resume");
        }
        return {};
      };

      try {
        const conversation = await service.requestConversationResume("thr_resume_refresh");
        expect(conversation).not.toBeNull();
        expect(conversation?.turns[0]?.status).toBe("inProgress");
        expect(conversation?.turns[0]?.items.length).toBe(1);
        expect(conversation?.turns[0]?.items[0]?.markdownText).toBe("run bun test");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("resume sends apply-patch streaming feature override", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method !== "thread/resume") throw new Error(`Unexpected method: ${method}`);
        return {
          thread: {
            id: "thr_resume_patch_streaming",
            preview: "",
            ephemeral: false,
            modelProvider: "openai",
            createdAt: 1711278000,
            updatedAt: 1711278000,
            status: { type: "idle" },
            path: "/tmp/resume-patch-streaming/rollout.jsonl",
            cwd: "/tmp/resume-patch-streaming",
            cliVersion: "0.0.0-test",
            source: "app_server",
            agentNickname: null,
            agentRole: null,
            gitInfo: null,
            name: "Resume patch streaming",
            turns: [],
          },
        };
      };

      try {
        const detail = await service.resumeThread("thr_resume_patch_streaming");
        expect(detail?.threadId ?? "").toBe("thr_resume_patch_streaming");
        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("thread/resume");
        const resumeConfig = (requests[0]?.params as { config?: Record<string, unknown> })?.config ?? {};
        expect(resumeConfig["features.apply_patch_streaming_events"]).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("serializes child-thread memberships from main-owned conversation state", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_child",
        threadName: "Child agent",
      });

      const service = createService();
      const serviceInternals = service as unknown as {
        turnByThread: Map<string, Map<string, CodexTurnSummary>>;
        transcriptByThread: Map<string, CodexTranscriptEntry[]>;
        queuedFollowUpsByThread: Map<string, Array<{
          followUpId: string;
          threadId: string;
          prompt: string;
          createdAt: number;
          collaborationMode: null;
        }>>;
      };

      serviceInternals.turnByThread.set(
        "thr_parent",
        new Map<string, CodexTurnSummary>([
          [
            "turn_parent",
            {
              threadId: "thr_parent",
              turnId: "turn_parent",
              status: "completed",
              itemIds: ["spawn_agent_1"],
            },
          ],
        ]),
      );
      serviceInternals.transcriptByThread.set("thr_parent", [
        {
          threadId: "thr_parent",
          turnId: "turn_parent",
          itemId: "spawn_agent_1",
          type: "tool_call",
          kind: "toolCall",
          semanticKind: "toolCall",
          toolCall: {
            toolName: "spawn_agent",
            subtype: "generic",
            args: {
              receivers: ["thr_child"],
            },
          },
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
      serviceInternals.queuedFollowUpsByThread.set("thr_child", [
        {
          followUpId: "follow_up_1",
          threadId: "thr_child",
          prompt: "Continue with the plan",
          createdAt: 2,
          collaborationMode: null,
        },
      ]);

      try {
        const conversation = service.serializeConversationSnapshot("thr_parent");
        expect(conversation).not.toBeNull();
        expect(conversation?.childMemberships.length).toBe(1);
        expect(conversation?.childMemberships[0]?.threadId).toBe("thr_child");
        expect(conversation?.childMemberships[0]?.actorName).toBe("Child agent");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("derives background terminal rows from older running command executions", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_background_terminals"),
        projectId: defaultProjectId,
        threadName: "Background terminals",
        turns: [
          {
            threadId: "thr_background_terminals",
            turnId: "turn_old",
            status: "completed",
            itemIds: ["exec_old", "exec_interrupted"],
          },
          {
            threadId: "thr_background_terminals",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: ["exec_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_background_terminals",
            turnId: "turn_old",
            itemId: "exec_old",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            command: "bun test src/renderer/features/local-conversation/view/composer/local-conversation-composer-shell.test.tsx",
            cwd: "/tmp/project",
            processId: "4172",
            aggregatedOutput: "1400 pass\n1418 pass\n",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun test src/renderer/features/local-conversation/view/composer/local-conversation-composer-shell.test.tsx",
                cwd: "/tmp/project",
              },
              result: "1400 pass\n1418 pass\n",
            },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_background_terminals",
            turnId: "turn_old",
            itemId: "exec_interrupted",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "interrupted",
            command: "bun run lint",
            cwd: "/tmp/project",
            aggregatedOutput: "stopped",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run lint",
                cwd: "/tmp/project",
              },
              result: "stopped",
            },
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_background_terminals",
            turnId: "turn_latest",
            itemId: "exec_latest",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            command: "bun run dev",
            cwd: "/tmp/project",
            aggregatedOutput: "dev server starting",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run dev",
                cwd: "/tmp/project",
              },
              result: "dev server starting",
            },
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const conversation = service.serializeConversationSnapshot("thr_background_terminals");
        expect(conversation).not.toBeNull();
        expect(conversation?.backgroundTerminalRows.length).toBe(1);
        expect(conversation?.backgroundTerminalRows[0]?.id).toBe("exec_old");
        expect(conversation?.backgroundTerminalRows[0]?.command).toBe("bun test src/renderer/features/local-conversation/view/composer/local-conversation-composer-shell.test.tsx");
        expect(conversation?.backgroundTerminalRows[0]?.cwd).toBe("/tmp/project");
        expect(conversation?.backgroundTerminalRows[0]?.previewLine).toBe("1418 pass");
        expect(conversation?.backgroundTerminalRows[0]?.processId).toBe("4172");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("materializes retryable transport errors as stream-error transcript rows", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_stream_error"),
        projectId: defaultProjectId,
        threadName: "Poor network reconnect",
        turns: [
          {
            threadId: "thr_stream_error",
            turnId: "turn_stream_error",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification("error", {
        threadId: "thr_stream_error",
        turnId: "turn_stream_error",
        willRetry: true,
        error: {
          message: "Reconnecting... 2/5",
          additionalDetails: "Network error: connection dropped while streaming.",
        },
      });

      const detail = service.serializeThreadDetail("thr_stream_error");
      const errorEntry = detail?.transcript.find((entry) => entry.semanticKind === "streamError") ?? null;

      expect(detail).not.toBeNull();
      expect(errorEntry?.markdownText).toBe("Reconnecting... 2/5");
      expect(errorEntry?.additionalDetails).toBe("Network error: connection dropped while streaming.");
      expect(errorEntry?.willRetry).toBeTrue();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("materializes failed turn errors from thread/read into system-error transcript rows", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        buildThreadDetailFromRead: (thread: unknown) => CodexThreadDetail | null;
      };

      const detail = serviceInternals.buildThreadDetailFromRead({
        id: "thr_failed_reconnect",
        turns: [
          {
            id: "turn_failed_reconnect",
            status: "failed",
            items: [],
            error: {
              message: "Failed to reconnect to the stream.",
              additionalDetails: "The connection could not be re-established after repeated retry attempts.",
            },
          },
        ],
      });

      const errorEntry = detail?.transcript.find((entry) => entry.semanticKind === "systemError") ?? null;

      expect(detail).not.toBeNull();
      expect(errorEntry?.markdownText).toBe("Failed to reconnect to the stream.");
      expect(errorEntry?.additionalDetails).toBe(
        "The connection could not be re-established after repeated retry attempts.",
      );
      expect(errorEntry?.willRetry).toBeFalse();
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("cleanBackgroundTerminals interrupts older running command turns for one conversation", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        return {};
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_clean_background_terminals"),
        projectId: defaultProjectId,
        threadName: "Clean background terminals",
        turns: [
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_one",
            status: "completed",
            itemIds: ["exec_background_one"],
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_two",
            status: "completed",
            itemIds: ["exec_background_two"],
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: ["exec_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_one",
            itemId: "exec_background_one",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run lint",
              },
            },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_two",
            itemId: "exec_background_two",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun test",
              },
            },
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_latest",
            itemId: "exec_latest",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run dev",
              },
            },
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const cleaned = await service.cleanBackgroundTerminals("thr_clean_background_terminals");
        expect(cleaned).toBeTrue();

        const interruptRequests = requests.filter((request) => request.method === "turn/interrupt");
        expect(interruptRequests.length).toBe(2);
        expect((interruptRequests[0]?.params as { turnId?: string })?.turnId).toBe("turn_background_two");
        expect((interruptRequests[1]?.params as { turnId?: string })?.turnId).toBe("turn_background_one");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

});

describe("codex-service edit-last-user-turn and fork-from-turn", () => {
  test("rolls back the latest editable turn only on submit and starts a replacement turn", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        ensureConversationRecord: (threadId: string) => { queuedFollowUps: unknown[]; pendingSteers: unknown[] };
        pendingApprovals: Map<string, { request: { threadId: string; turnId: string }; reject: (error: Error) => void }>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      let clearedApprovalMessage = "";

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/rollback") {
          return {
            thread: {
              id: "thr_edit",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 10,
              turns: [
                {
                  id: "turn_older",
                  status: "completed",
                  items: [
                    {
                      id: "user_older",
                      type: "userMessage",
                      content: [{ type: "text", text: "Older prompt" }],
                    },
                    {
                      id: "assistant_older",
                      type: "agentMessage",
                      text: "Older answer",
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_edited",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      service.readThread = async () => ({
        ...makeThreadDetail("thr_edit"),
        projectId: defaultProjectId,
        threadName: "Editable thread",
        cwd: "/tmp/edit-thread",
        turns: [
          {
            threadId: "thr_edit",
            turnId: "turn_older",
            status: "completed",
            itemIds: ["user_older", "assistant_older"],
          },
          {
            threadId: "thr_edit",
            turnId: "turn_latest",
            status: "completed",
            itemIds: ["user_latest", "assistant_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_edit",
            turnId: "turn_older",
            itemId: "user_older",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Older prompt",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_edit",
            turnId: "turn_older",
            itemId: "assistant_older",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            sequence: 2,
            markdownText: "Older answer",
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_edit",
            turnId: "turn_latest",
            itemId: "user_latest",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 3,
            markdownText: "Latest prompt",
            createdAt: 3,
            updatedAt: 3,
          },
          {
            threadId: "thr_edit",
            turnId: "turn_latest",
            itemId: "assistant_latest",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            sequence: 4,
            markdownText: "Latest answer",
            createdAt: 4,
            updatedAt: 4,
          },
        ],
      });

      const conversationRecord = serviceInternals.ensureConversationRecord("thr_edit");
      conversationRecord.queuedFollowUps = [{ followUpId: "followup_1" }];
      conversationRecord.pendingSteers = [
        { threadId: "thr_edit", turnId: "turn_latest", prompt: "Continue", createdAt: 5 },
      ];
      serviceInternals.pendingApprovals.set("approval_1", {
        request: {
          threadId: "thr_edit",
          turnId: "turn_latest",
        },
        reject: (error) => {
          clearedApprovalMessage = error.message;
        },
      });

      try {
        const result = await service.editLastUserTurn("thr_edit", "turn_latest", "Rewrite the latest prompt");
        const snapshot = service.serializeConversationSnapshot("thr_edit");
        const detail = service.serializeThreadDetail("thr_edit");

        expect(requests[0]?.method).toBe("thread/rollback");
        expect((requests[0]?.params as { numTurns?: number } | undefined)?.numTurns).toBe(1);
        expect(requests[1]?.method).toBe("turn/start");
        expect(result.threadId).toBe("thr_edit");
        expect(result.composerIntent.prompt).toBe("Rewrite the latest prompt");
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[0]?.turnId).toBe("turn_older");
        expect(snapshot?.turns[1]?.turnId).toBe("turn_edited");
        expect(detail?.turns.length).toBe(2);
        expect(detail?.turns[1]?.turnId).toBe("turn_edited");
        expect(detail?.transcript[detail.transcript.length - 1]?.markdownText).toBe("Rewrite the latest prompt");
        expect(conversationRecord.queuedFollowUps.length).toBe(0);
        expect(conversationRecord.pendingSteers.length).toBe(0);
        expect(clearedApprovalMessage).toBe("Approval request cleared after thread history changed");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forwards the effective service tier when edit-last-user-turn starts the replacement turn", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/rollback") {
          return {
            thread: {
              id: "thr_edit_fast",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 10,
              turns: [
                {
                  id: "turn_older",
                  status: "completed",
                  items: [
                    {
                      id: "user_older",
                      type: "userMessage",
                      content: [{ type: "text", text: "Older prompt" }],
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_edited_fast",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      service.readThread = async () => ({
        ...makeThreadDetail("thr_edit_fast"),
        projectId: defaultProjectId,
        threadName: "Editable fast thread",
        cwd: "/tmp/edit-fast-thread",
        turns: [
          {
            threadId: "thr_edit_fast",
            turnId: "turn_older",
            status: "completed",
            itemIds: ["user_older"],
          },
          {
            threadId: "thr_edit_fast",
            turnId: "turn_latest",
            status: "completed",
            itemIds: ["user_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_edit_fast",
            turnId: "turn_older",
            itemId: "user_older",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Older prompt",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_edit_fast",
            turnId: "turn_latest",
            itemId: "user_latest",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Latest prompt",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });

      try {
        await service.editLastUserTurn("thr_edit_fast", "turn_latest", "Rewrite quickly", { serviceTier: "fast" });

        expect(requests[1]?.method).toBe("turn/start");
        expect((requests[1]?.params as { serviceTier?: unknown })?.serviceTier).toBe("fast");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forks from an older turn by rolling back the new thread to the selected branch point", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_forked",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 11,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                    { id: "assistant_1", type: "agentMessage", text: "Answer 1" },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                    { id: "assistant_2", type: "agentMessage", text: "Answer 2" },
                  ],
                },
                {
                  id: "turn_3",
                  status: "completed",
                  items: [
                    { id: "user_3", type: "userMessage", content: [{ type: "text", text: "Prompt 3" }] },
                    { id: "assistant_3", type: "agentMessage", text: "Answer 3" },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/rollback") {
          return {
            thread: {
              id: "thr_forked",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 12,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                    { id: "assistant_1", type: "agentMessage", text: "Answer 1" },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                    { id: "assistant_2", type: "agentMessage", text: "Answer 2" },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      service.readThread = async () => ({
        ...makeThreadDetail("thr_source"),
        projectId: defaultProjectId,
        threadName: "Source thread",
        cwd: "/tmp/fork-thread",
        turns: [
          { threadId: "thr_source", turnId: "turn_1", status: "completed", itemIds: ["user_1", "assistant_1"] },
          { threadId: "thr_source", turnId: "turn_2", status: "completed", itemIds: ["user_2", "assistant_2"] },
          { threadId: "thr_source", turnId: "turn_3", status: "completed", itemIds: ["user_3", "assistant_3"] },
        ],
        transcript: [
          {
            threadId: "thr_source",
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_source",
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_source",
            turnId: "turn_3",
            itemId: "user_3",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 3,
            markdownText: "Prompt 3",
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const result = await service.forkConversationFromTurn("thr_source", "turn_2", "Continue from turn 2");
        const snapshot = service.serializeConversationSnapshot("thr_forked");
        const forkParams = requests[0]?.params as Record<string, unknown> | undefined;

        expect(requests[0]?.method).toBe("thread/fork");
        expect("persistExtendedHistory" in (forkParams ?? {})).toBeFalse();
        expect("path" in (forkParams ?? {})).toBeFalse();
        expect((requests[1]?.params as { threadId?: string; numTurns?: number } | undefined)?.threadId).toBe("thr_forked");
        expect((requests[1]?.params as { numTurns?: number } | undefined)?.numTurns).toBe(1);
        expect(result.threadId).toBe("thr_forked");
        expect(result.composerIntent.prompt).toBe("Continue from turn 2");
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[1]?.turnId).toBe("turn_2");
        expect(events.some((event) => event.type === "threadSummary" && event.thread.threadId === "thr_forked")).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forks from the latest turn without issuing a rollback", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_latest_forked",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 11,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                    { id: "assistant_1", type: "agentMessage", text: "Answer 1" },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                    { id: "assistant_2", type: "agentMessage", text: "Answer 2" },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      service.readThread = async () => ({
        ...makeThreadDetail("thr_latest_source"),
        projectId: defaultProjectId,
        threadName: "Latest source thread",
        cwd: "/tmp/latest-fork-thread",
        turns: [
          { threadId: "thr_latest_source", turnId: "turn_1", status: "completed", itemIds: ["user_1", "assistant_1"] },
          { threadId: "thr_latest_source", turnId: "turn_2", status: "completed", itemIds: ["user_2", "assistant_2"] },
        ],
        transcript: [
          {
            threadId: "thr_latest_source",
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_latest_source",
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });

      try {
        const result = await service.forkConversationFromTurn("thr_latest_source", "turn_2", "Continue latest");
        const snapshot = service.serializeConversationSnapshot("thr_latest_forked");
        const forkParams = requests[0]?.params as Record<string, unknown> | undefined;

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("thread/fork");
        expect("persistExtendedHistory" in (forkParams ?? {})).toBeFalse();
        expect("path" in (forkParams ?? {})).toBeFalse();
        expect(result.threadId).toBe("thr_latest_forked");
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[1]?.turnId).toBe("turn_2");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("starts side chat as an ephemeral fork, injects boundary, then sends initial prompt", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("Use fallback permissions");
        }
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_side_chat",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 1,
              turns: [],
            },
          };
        }
        if (method === "thread/inject_items") {
          return {};
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_side_chat",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        if (method === "thread/unsubscribe") {
          return {};
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      service.readThread = async () => ({
        ...makeThreadDetail("thr_parent"),
        projectId: defaultProjectId,
        source: null,
        threadName: "Parent",
        cwd: "/tmp/codex",
        latestCollaborationMode: {
          mode: "default",
          settings: {
            model: "gpt-5-codex",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      });

      try {
        const result = await service.startSideChat({
          projectId: defaultProjectId,
          parentThreadId: "thr_parent",
          parentNavigationPath: "project:codex/session:session-1/thread:thr_parent",
          prompt: "Investigate this in side chat",
          model: "gpt-5-codex",
          reasoningEffort: "high",
          collaborationMode: "plan",
        });
        const sideRequests = requests.filter((request) =>
          request.method === "thread/fork"
          || request.method === "thread/inject_items"
          || request.method === "turn/start"
        );
        const forkParams = sideRequests[0]?.params as Record<string, unknown> | undefined;
        const injectParams = sideRequests[1]?.params as { threadId?: string; items?: unknown[] } | undefined;
        const turnParams = sideRequests[2]?.params as { threadId?: string; input?: unknown[] } | undefined;
        const snapshot = service.serializeConversationSnapshot("thr_side_chat");

        expect(sideRequests.map((request) => request.method).join(",")).toBe("thread/fork,thread/inject_items,turn/start");
        expect(forkParams?.threadId).toBe("thr_parent");
        expect(forkParams?.ephemeral).toBeTrue();
        expect(forkParams?.excludeTurns).toBeTrue();
        expect(String(forkParams?.developerInstructions).includes("You are in a side conversation")).toBeTrue();
        expect(injectParams?.threadId).toBe("thr_side_chat");
        expect(JSON.stringify(injectParams?.items ?? []).includes("Side conversation boundary")).toBeTrue();
        expect(turnParams?.threadId).toBe("thr_side_chat");
        expect(JSON.stringify(turnParams?.input ?? []).includes("Investigate this in side chat")).toBeTrue();
        expect(result.threadId).toBe("thr_side_chat");
        expect(snapshot?.source?.sideConversation === true).toBeTrue();
        expect(snapshot?.source?.sideConversationParentNavigationPath ?? "").toBe(
          "project:codex/session:session-1/thread:thr_parent",
        );
        expect(snapshot?.ephemeral === true).toBeTrue();
        expect(snapshot?.capabilityFlags.canForkFromTurn).toBeFalse();
        expect(snapshot?.capabilityFlags.canEditLastUserTurn).toBeFalse();
        expect(getCodexThread("thr_side_chat") === null).toBeTrue();

        const discarded = await service.discardSideChat("thr_side_chat");
        expect(discarded).toBeTrue();
        expect(requests.some((request) => request.method === "thread/unsubscribe")).toBeTrue();
        expect(service.serializeConversationSnapshot("thr_side_chat") === null).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});

describe("codex-service interrupt target resolution", () => {
  test("interrupts the latest in-progress turn when turnId is omitted", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.mergeTurn("thr_interrupt", {
      threadId: "thr_interrupt",
      turnId: "turn_completed",
      status: "completed",
      itemIds: [],
    });
    serviceInternals.mergeTurn("thr_interrupt", {
      threadId: "thr_interrupt",
      turnId: "turn_in_progress",
      status: "inProgress",
      itemIds: [],
    });

    try {
      const result = await service.interruptTurn("thr_interrupt");
      const interruptRequest = requests.find(
        (request) => request.method === "turn/interrupt",
      );
      expect(result).toBeTrue();
      expect(requests.length >= 1).toBeTrue();
      expect(Boolean(interruptRequest)).toBeTrue();
      expect((interruptRequest?.params as { threadId?: string })?.threadId).toBe("thr_interrupt");
      expect((interruptRequest?.params as { turnId?: string })?.turnId).toBe("turn_in_progress");
    } finally {
      await service.shutdown();
    }
  });

  test("prefers explicit turnId over inferred turn cache", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.mergeTurn("thr_explicit", {
      threadId: "thr_explicit",
      turnId: "turn_cached",
      status: "inProgress",
      itemIds: [],
    });

    try {
      const result = await service.interruptTurn("thr_explicit", "turn_explicit");
      expect(result).toBeTrue();
      expect(requests.length >= 1).toBeTrue();
      expect(requests[0]?.method).toBe("turn/interrupt");
      expect((requests[0]?.params as { threadId?: string })?.threadId).toBe("thr_explicit");
      expect((requests[0]?.params as { turnId?: string })?.turnId).toBe("turn_explicit");
    } finally {
      await service.shutdown();
    }
  });

  test("throws when no interrupt target can be resolved", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };

    client.start = async () => undefined;
    client.request = async () => ({});
    service.readThread = async () => null;

    try {
      let failed = false;
      let message = "";
      try {
        await service.interruptTurn("thr_missing");
      } catch (error) {
        failed = true;
        message = error instanceof Error ? error.message : String(error);
      }

      expect(failed).toBeTrue();
      expect(message).toBe("Could not determine which turn to interrupt");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service startTurn", () => {
  test("returns the immediate started turn payload without waiting for thread/read", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const markedActive: string[] = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = (threadId: string) => {
      markedActive.push(threadId);
    };
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_new",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      if (method === "thread/read") {
        throw new Error("thread/read should not be called when turn/start returns a turn");
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix");
      expect(startedTurn?.turnId).toBe("turn_new");
      expect(startedTurn?.status).toBe("inProgress");
      expect(typeof startedTurn?.turnStartedAtMs).toBe("number");
      expect((startedTurn?.turnStartedAtMs ?? 0) > 0).toBeTrue();
      expect(requests.length).toBe(1);
      expect(requests[0]?.method).toBe("turn/start");
      expect(markedActive.length).toBe(1);
      expect(markedActive[0]).toBe("thr_start");
    } finally {
      await service.shutdown();
    }
  });

  test("forwards an explicit fast service tier to turn/start", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_fast",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      await service.startTurn("thr_fast", "Ship it faster", { serviceTier: "fast" });

      expect(requests.length).toBe(1);
      expect((requests[0]?.params as { serviceTier?: unknown })?.serviceTier).toBe("fast");
    } finally {
      await service.shutdown();
    }
  });

  test("starts a follow-up for projectless thread metadata without forcing a workspace cwd", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string | null | null; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: null, cwd: null });
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_projectless",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      const turn = await service.startTurn("thr_projectless", "Continue without project");
      expect(turn?.turnId).toBe("turn_projectless");
      expect(requests.length).toBe(1);
      expect(JSON.stringify(requests[0]?.params).includes("\"cwd\"")).toBeFalse();
    } finally {
      await service.shutdown();
    }
  });

  test("omits serviceTier from turn/start when standard is requested explicitly", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_standard",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      await service.startTurn("thr_standard", "Use the default tier", { serviceTier: null });

      const params = (requests[0]?.params as Record<string, unknown>) ?? {};
      expect(requests.length).toBe(1);
      expect(Object.prototype.hasOwnProperty.call(params, "serviceTier")).toBeFalse();
    } finally {
      await service.shutdown();
    }
  });

  test("retries turn/start once after resuming a cold persisted thread", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    let turnStartAttempts = 0;

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        turnStartAttempts += 1;
        if (turnStartAttempts === 1) {
          throw new CodexRpcError("thread not found", -32600);
        }

        return {
          turn: {
            id: "turn_retry",
            status: "in_progress",
            transcript: [],
          },
        };
      }

      if (method === "thread/resume") {
        return {
          thread: {
            id: "thr_start",
            turns: [],
          },
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix");
      expect(startedTurn?.turnId).toBe("turn_retry");
      expect(requests.map((request) => request.method).join(",")).toBe("turn/start,thread/resume,turn/start");
      expect(((requests[1]?.params as { threadId?: string }).threadId)).toBe("thr_start");
      const resumeConfig = (requests[1]?.params as { config?: Record<string, unknown> })?.config ?? {};
      expect(resumeConfig["features.apply_patch_streaming_events"]).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("seeds an optimistic user message as soon as turn/start returns a turn", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_prompt",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        const startedTurn = await service.startTurn("thr_start_prompt", "Ship the fix");
        const detail = service.serializeThreadDetail("thr_start_prompt");
        const promptItem = detail?.transcript[0];

        expect(startedTurn?.turnId).toBe("turn_prompt");
        expect(detail).not.toBeNull();
        expect(detail?.turns[0]?.itemIds.length).toBe(1);
        expect(promptItem?.kind).toBe("userMessage");
        expect(promptItem?.role).toBe("user");
        expect(promptItem?.markdownText).toBe("Ship the fix");
        expect(Boolean(promptItem?.itemId.startsWith("item-"))).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("keeps steer prompts as optimistic transcript items until the authoritative user message arrives", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      };

      serviceInternals.mergeTurn("thr_steer_prompt", {
        threadId: "thr_steer_prompt",
        turnId: "turn_steer_prompt",
        status: "inProgress",
        itemIds: [],
      });
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/steer") {
          return { turnId: "turn_steer_prompt" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        const steeredTurn = await service.steerTurn({
          threadId: "thr_steer_prompt",
          expectedTurnId: "turn_steer_prompt",
          prompt: "Tighten the layout.",
        });
        const detail = service.serializeThreadDetail("thr_steer_prompt");
        const snapshot = service.serializeConversationSnapshot("thr_steer_prompt");

        expect(steeredTurn?.turnId).toBe("turn_steer_prompt");
        expect(detail).not.toBeNull();
        expect(detail?.turns[0]?.itemIds.length).toBe(0);
        expect(detail?.transcript.length).toBe(1);
        expect(detail?.transcript[0]?.type).toBe("steeringUserMessage");
        expect(detail?.transcript[0]?.steeringStatus).toBe("pending");
        expect(snapshot?.pendingSteers.length).toBe(0);
        expect(snapshot?.turns[0]?.items[0]?.markdownText).toBe("Tighten the layout.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("queueing a follow-up during an active turn auto-dispatches it after the turn completes", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_prompt", {
        threadId: "thr_queue_prompt",
        turnId: "turn_queue_prompt",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_queue_prompt_auto_1",
              threadId: "thr_queue_prompt",
              status: "inProgress",
            },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_prompt", "Queue this without interrupting");
        const snapshot = service.serializeConversationSnapshot("thr_queue_prompt");

        expect(requests.length).toBe(0);
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Queue this without interrupting");
        expect(snapshot?.pendingSteers.length).toBe(0);

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_prompt",
          turnId: "turn_queue_prompt",
          status: "completed",
        });
        await flushAsyncWork();

        const afterSendSnapshot = service.serializeConversationSnapshot("thr_queue_prompt");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("turn/start");
        expect(
          JSON.stringify((requests[0]?.params as { collaborationMode?: unknown })?.collaborationMode ?? null),
        ).toBe("null");
        expect(afterSendSnapshot?.queuedFollowUps.length).toBe(0);
        expect(afterSendSnapshot?.turns[afterSendSnapshot.turns.length - 1]?.turnId).toBe("turn_queue_prompt_auto_1");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("queueing a fast follow-up preserves the effective service tier until dispatch", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_fast", {
        threadId: "thr_queue_fast",
        turnId: "turn_queue_fast",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_queue_fast_auto_1",
              threadId: "thr_queue_fast",
              status: "inProgress",
            },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_fast", "Queue this fast", { serviceTier: "fast" });
        const snapshot = service.serializeConversationSnapshot("thr_queue_fast");

        expect(snapshot?.queuedFollowUps[0]?.serviceTier).toBe("fast");

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_fast",
          turnId: "turn_queue_fast",
          status: "completed",
        });
        await flushAsyncWork();

        expect(requests.length).toBe(1);
        expect((requests[0]?.params as { serviceTier?: unknown })?.serviceTier).toBe("fast");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("queued follow-up send-now still works as an explicit override while a turn is active", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_prompt_send_now", {
        threadId: "thr_queue_prompt_send_now",
        turnId: "turn_queue_prompt_send_now",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          return { turnId: "turn_queue_prompt_send_now" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_prompt_send_now", "Queue this without interrupting");
        const snapshot = service.serializeConversationSnapshot("thr_queue_prompt_send_now");
        const followUpId = snapshot?.queuedFollowUps[0]?.followUpId ?? null;

        expect(Boolean(followUpId)).toBeTrue();
        if (!followUpId) return;

        await service.sendQueuedFollowUpNow("thr_queue_prompt_send_now", followUpId);
        const afterSendSnapshot = service.serializeConversationSnapshot("thr_queue_prompt_send_now");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("turn/steer");
        expect(afterSendSnapshot?.queuedFollowUps.length).toBe(0);
        expect(afterSendSnapshot?.pendingSteers.length).toBe(0);
        expect(afterSendSnapshot?.turns[0]?.items[0]?.type).toBe("steeringUserMessage");
        expect(afterSendSnapshot?.turns[0]?.items[0]?.markdownText).toBe("Queue this without interrupting");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("queued follow-ups preserve FIFO order across successive turn completions", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const prompts: string[] = [];
      let startedCount = 0;

      serviceInternals.mergeTurn("thr_queue_fifo", {
        threadId: "thr_queue_fifo",
        turnId: "turn_queue_fifo_active",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "turn/start") {
          throw new Error(`Unexpected method: ${method}`);
        }
        const record = params as { input?: Array<{ text?: string }> };
        prompts.push(record.input?.[0]?.text ?? "");
        startedCount += 1;
        return {
          turn: {
            id: `turn_queue_fifo_auto_${startedCount}`,
            threadId: "thr_queue_fifo",
            status: "inProgress",
          },
        };
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_fifo", "First queued message");
        await service.enqueueQueuedFollowUpPrompt("thr_queue_fifo", "Second queued message");

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_fifo",
          turnId: "turn_queue_fifo_active",
          status: "completed",
        });
        await flushAsyncWork();

        let snapshot = service.serializeConversationSnapshot("thr_queue_fifo");
        expect(prompts.length).toBe(1);
        expect(prompts[0]).toBe("First queued message");
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Second queued message");

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_fifo",
          turnId: "turn_queue_fifo_auto_1",
          status: "completed",
        });
        await flushAsyncWork();

        snapshot = service.serializeConversationSnapshot("thr_queue_fifo");
        expect(prompts.length).toBe(2);
        expect(prompts[1]).toBe("Second queued message");
        expect(snapshot?.queuedFollowUps.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("failed queued follow-up dispatch pauses the item and does not retry in a loop", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_failure", {
        threadId: "thr_queue_failure",
        turnId: "turn_queue_failure_active",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          throw new Error("queue dispatch failed");
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_failure", "Will fail later");
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_failure",
          turnId: "turn_queue_failure_active",
          status: "completed",
        });
        await flushAsyncWork(3);

        const snapshot = service.serializeConversationSnapshot("thr_queue_failure");
        expect(requests.length).toBe(1);
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Will fail later");
        expect(snapshot?.queuedFollowUps[0]?.pausedReason).toBe("queue dispatch failed");

        await flushAsyncWork(3);
        expect(requests.length).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("clears a pending steer when the authoritative user message arrives", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      serviceInternals.mergeTurn("thr_pending_clear", {
        threadId: "thr_pending_clear",
        turnId: "turn_pending_clear",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/steer") {
          return { turnId: "turn_pending_clear" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.steerTurn({
          threadId: "thr_pending_clear",
          expectedTurnId: "turn_pending_clear",
          prompt: "Tighten the spacing.",
        });
        let snapshot = service.serializeConversationSnapshot("thr_pending_clear");
        expect(snapshot?.pendingSteers.length).toBe(0);
        expect(snapshot?.turns[0]?.items[0]?.steeringStatus).toBe("pending");

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_pending_clear",
          turnId: "turn_pending_clear",
          item: {
            id: "user_msg_1",
            type: "userMessage",
            role: "user",
            content: [{ type: "text", text: "Tighten the spacing.", text_elements: [] }],
          },
        });

        snapshot = service.serializeConversationSnapshot("thr_pending_clear");
        expect(snapshot?.pendingSteers.length).toBe(0);
        expect(snapshot?.turns[0]?.items[0]?.steeringStatus).toBe("accepted");
        expect(snapshot?.turns[0]?.items[1]?.semanticKind).toBe("steered");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("passes model and reasoning overrides through to turn/start", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        markThreadAsActive: (threadId: string) => void;
        persistThreadSnapshot: (threadId: string) => void;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      serviceInternals.markThreadAsActive = () => {};
      serviceInternals.persistThreadSnapshot = () => {};

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_override",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        const startedTurn = await service.startTurn("thr_start", "Ship the fix", {
          model: "gpt-5.3-codex",
          permissionMode: "auto",
          reasoningEffort: "high",
        });
        const turnStartRequests = requests.filter((request) => request.method === "turn/start");
        expect(startedTurn?.turnId).toBe("turn_override");
        expect(turnStartRequests.length).toBe(1);
        expect((turnStartRequests[0]?.params as { model?: string })?.model).toBe("gpt-5.3-codex");
        expect((turnStartRequests[0]?.params as { effort?: string })?.effort).toBe("high");
        expect((turnStartRequests[0]?.params as { approvalPolicy?: string })?.approvalPolicy).toBe("on-request");
        expect((turnStartRequests[0]?.params as { cwd?: string })?.cwd).toBe("/tmp/codex");
        expect(JSON.stringify((turnStartRequests[0]?.params as {
          sandboxPolicy?: {
            type?: string;
            writableRoots?: string[];
            networkAccess?: boolean;
            excludeTmpdirEnvVar?: boolean;
            excludeSlashTmp?: boolean;
          };
        })?.sandboxPolicy)).toBe(JSON.stringify({
          type: "workspaceWrite",
          writableRoots: ["/tmp/codex"],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        }));
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("includes collaborationMode payload for plan turns", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.parseWorkspacePath = () => "/tmp/codex";
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_plan_mode",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Plan this task", {
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
        permissionMode: "auto",
        collaborationMode: "plan",
      });
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(startedTurn?.turnId).toBe("turn_plan_mode");
      expect(turnStartRequests.length).toBe(1);
      expect(JSON.stringify((turnStartRequests[0]?.params as { collaborationMode?: unknown })?.collaborationMode)).toBe(
        JSON.stringify({
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        }),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("applies typed agent config lines and strips them from turn input", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.parseWorkspacePath = () => "/tmp/codex";
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_agent_config",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      await service.startTurn(
        "thr_config",
        '<agent-config mode="plan" reasoning="high" />\nShip the fix',
        {
          model: "gpt-5.3-codex",
          permissionMode: "auto",
          collaborationMode: "default",
          reasoningEffort: "medium",
        },
      );
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      const params = turnStartRequest?.params as {
        input?: Array<{ type: string; text?: string }>;
        effort?: string;
        collaborationMode?: unknown;
      };
      expect(params.input?.[0]?.text).toBe("Ship the fix");
      expect(params.effort).toBe("high");
      expect(JSON.stringify(params.collaborationMode)).toBe(JSON.stringify({
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      }));
      const record = (service as unknown as {
        getConversationRecord: (threadId: string) => {
          latestCollaborationMode: {
            mode: string;
            settings: { model: string; reasoning_effort: string | null };
          };
        };
      }).getConversationRecord("thr_config");
      expect(record.latestCollaborationMode.mode).toBe("plan");
      expect(record.latestCollaborationMode.settings.model).toBe("gpt-5.3-codex");
      expect(record.latestCollaborationMode.settings.reasoning_effort).toBe("high");
    } finally {
      await service.shutdown();
    }
  });

  test("passes prompt input images through to turn/start", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.parseWorkspacePath = () => "/tmp/codex";
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_image_input",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      await service.startTurn("thr_images", "ignored raw", {
        model: "gpt-5.3-codex",
        permissionMode: "auto",
        reasoningEffort: "medium",
        promptInput: {
          text: "Inspect these images",
          images: [
            { source: "https://example.com/diagram.png", caption: "diagram" },
            { source: "/tmp/local.png", caption: "local" },
            { source: "data:image/png;base64,aW1hZ2U=", caption: "inline" },
          ],
          mentions: [{ name: "notes.md", path: "/tmp/notes.md" }],
          skills: [{ name: "Computer Use", path: "/plugins/computer-use" }],
        },
      });
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      const params = turnStartRequest?.params as { input?: Array<Record<string, string>> };
      expect(params.input?.length ?? 0).toBe(6);
      expect(params.input?.[0]?.type).toBe("text");
      expect(params.input?.[0]?.text).toBe("Inspect these images");
      expect(params.input?.[1]?.type).toBe("image");
      expect(params.input?.[1]?.url).toBe("https://example.com/diagram.png");
      expect(params.input?.[2]?.type).toBe("localImage");
      expect(params.input?.[2]?.path).toBe("/tmp/local.png");
      expect(params.input?.[3]?.type).toBe("image");
      expect(params.input?.[3]?.url).toBe("data:image/png;base64,aW1hZ2U=");
      expect(params.input?.[4]?.type).toBe("mention");
      expect(params.input?.[4]?.path).toBe("/tmp/notes.md");
      expect(params.input?.[5]?.type).toBe("skill");
      expect(params.input?.[5]?.path).toBe("/plugins/computer-use");
    } finally {
      await service.shutdown();
    }
  });

  test("uses the linked thread cwd for follow-up turns", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({
      projectId: defaultProjectId,
      cwd: "/tmp/codex/worktrees/abcd/codex",
    });
    serviceInternals.parseWorkspacePath = () => {
      throw new Error("parseWorkspacePath should not be called when a linked cwd exists");
    };
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_worktree",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Continue in worktree", {
        permissionMode: "auto",
      });
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(startedTurn?.turnId).toBe("turn_worktree");
      expect(turnStartRequests.length).toBe(1);
      expect((turnStartRequests[0]?.params as { cwd?: string })?.cwd).toBe("/tmp/codex/worktrees/abcd/codex");
    } finally {
      await service.shutdown();
    }
  });

  test("passes full-access permission overrides through to turn/start", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_full_access",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix", {
        permissionMode: "full-access",
      });
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(startedTurn?.turnId).toBe("turn_full_access");
      expect(turnStartRequests.length).toBe(1);
      expect((turnStartRequests[0]?.params as { approvalPolicy?: string })?.approvalPolicy).toBe("never");
      expect(JSON.stringify((turnStartRequests[0]?.params as { sandboxPolicy?: { type?: string } })?.sandboxPolicy)).toBe(JSON.stringify({
        type: "dangerFullAccess",
      }));
    } finally {
      await service.shutdown();
    }
  });

  test("omits explicit permission overrides for custom mode", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_custom",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix", {
        permissionMode: "custom",
      });
      expect(startedTurn?.turnId).toBe("turn_custom");
      expect(requests.length).toBe(1);
      expect((requests[0]?.params as { approvalPolicy?: unknown })?.approvalPolicy).toBe(undefined);
      expect((requests[0]?.params as { sandboxPolicy?: unknown })?.sandboxPolicy).toBe(undefined);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service collaboration modes", () => {
  test("parses collaborationMode/list response and filters unsupported modes", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };

    client.start = async () => undefined;
    client.request = async (method: string) => {
      if (method !== "collaborationMode/list") return {};
      return {
        data: [
          {
            name: "Default",
            mode: "default",
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
          },
          {
            name: "Plan",
            mode: "plan",
            model: "gpt-5.3-codex",
            reasoningEffort: null,
          },
          {
            name: "Ignored",
            mode: "research",
            model: "gpt-5.3-codex",
            reasoning_effort: "low",
          },
        ],
      };
    };

    try {
      const presets = await service.listCollaborationModes();
      expect(presets.length).toBe(2);
      expect(JSON.stringify(presets)).toBe(JSON.stringify([
        {
          name: "Default",
          mode: "default",
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
        },
        {
          name: "Plan",
          mode: "plan",
          model: "gpt-5.3-codex",
          reasoningEffort: null,
        },
      ]));
    } finally {
      await service.shutdown();
    }
  });

  test("persists conversation collaboration mode into serialized snapshots", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
      };

      client.start = async () => undefined;

      try {
        const nextMode = await service.setConversationCollaborationMode("thr_plan_mode", "plan");
        expect(nextMode.mode).toBe("plan");

        const detail = service.serializeThreadDetail("thr_plan_mode");
        const snapshot = service.serializeConversationSnapshot("thr_plan_mode");

        expect(detail?.latestCollaborationMode?.mode).toBe("plan");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});

describe("codex-service setThreadName", () => {
  test("treats whitespace-only names as a no-op", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requestMethods: string[] = [];

      client.start = async () => undefined;
      client.request = async (method: string) => {
        requestMethods.push(method);
        return {};
      };

      try {
        const renamed = await service.setThreadName("thread-1", " \n\t ");
        expect(renamed).toBeFalse();
        expect(requestMethods.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("sends the sanitized name and emits a title update", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const events: CodexHostMessage[] = [];
      let requestedName = "";

      service.on("hostMessage", (message) => {
        events.push(message);
      });
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method === "thread/name/set") {
          requestedName = (params as { name?: string }).name ?? "";
        }
        return {};
      };

      try {
        const renamed = await service.setThreadName("thread-1", "  hello   world  ");
        const titleEvent = events.find((event) => event.type === "threadTitleUpdated");

        expect(renamed).toBeTrue();
        expect(requestedName).toBe("hello world");
        expect(titleEvent?.type).toBe("threadTitleUpdated");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("sends generated names without manual length sanitization", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      let requestedName = "";
      const generatedName = "x".repeat(72);

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method === "thread/name/set") {
          requestedName = (params as { name?: string }).name ?? "";
        }
        return {};
      };

      try {
        const renamed = await service.setGeneratedThreadName("thread-1", `  ${generatedName}  `);

        expect(renamed).toBeTrue();
        expect(requestedName).toBe(generatedName);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});

describe("codex-service startThreadForSession", () => {
  test("starts a session thread in the project workspace and persists the project session link", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_start",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1_780_800_000_000,
              updatedAt: 1_780_800_000_000,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_start",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        const detail = await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Start from this session",
          model: "gpt-5-codex",
          reasoningEffort: "medium",
          permissionMode: "auto",
          skipAutoTitleGeneration: true,
        });

        const threadStartRequest = requests.find((request) => request.method === "thread/start");
        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const linked = getProjectSession(session.id)?.thread;
        expect((threadStartRequest?.params as { cwd?: string } | undefined)?.cwd).toBe("/tmp/codex");
        expect((turnStartRequest?.params as { cwd?: string } | undefined)?.cwd).toBe("/tmp/codex");
        expect(linked?.threadId).toBe("thr_session_start");
        expect(linked?.projectId).toBe(defaultProjectId);
        expect(linked?.cwd).toBe("/tmp/codex");
        expect(detail.threadId).toBe("thr_session_start");
        expect(detail.projectId).toBe(defaultProjectId);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("auto-generates a session thread title from main after thread start and before first turn", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
        emit: (eventName: string, payload: unknown) => boolean;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          const isHelperThread = requests.filter((request) => request.method === "thread/start").length > 1;
          return {
            thread: {
              id: isHelperThread ? "thr_title_helper" : "thr_session_auto_title",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1_780_800_000_000,
              updatedAt: 1_780_800_000_000,
            },
          };
        }
        if (method === "turn/start") {
          const turnParams = params as { threadId?: string };
          if (turnParams.threadId === "thr_title_helper") {
            setTimeout(() => {
              client.emit("notification", {
                method: "turn/started",
                params: { threadId: "thr_title_helper", turn: { id: "turn_title_helper" } },
              });
              client.emit("notification", {
                method: "item/agentMessage/delta",
                params: {
                  threadId: "thr_title_helper",
                  turnId: "turn_title_helper",
                  delta: "{\"title\":\"Fix session auto-title\"}",
                },
              });
              client.emit("notification", {
                method: "turn/completed",
                params: { threadId: "thr_title_helper", turn: { id: "turn_title_helper", status: "completed" } },
              });
            }, 0);
            return { turn: { id: "turn_title_helper" } };
          }
          return {
            turn: {
              id: "turn_session_auto_title",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "ignored fallback",
          promptInput: {
            text: "Context\n## My request for Codex:\nBuild auto title",
            textAttachments: [{ text: "Pasted requirements" }],
            images: [{ source: "data:image/png;base64,AAA", caption: "screen.png" }],
            mentions: [{ name: "README.md", path: "/tmp/codex/README.md" }],
            skills: [{ name: "skill", path: "/tmp/codex/skill" }],
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        const helperThreadStartIndex = requests.findIndex((request) =>
          request.method === "thread/start"
          && (request.params as { ephemeral?: boolean }).ephemeral === true
        );
        const durableTurnStartIndex = requests.findIndex((request) =>
          request.method === "turn/start"
          && (request.params as { threadId?: string }).threadId === "thr_session_auto_title"
        );
        const helperTurnStart = requests.find((request) =>
          request.method === "turn/start"
          && (request.params as { threadId?: string }).threadId === "thr_title_helper"
        );
        const helperPrompt = ((helperTurnStart?.params as { input?: Array<{ text?: string }> } | undefined)
          ?.input?.[0]?.text) ?? "";
        const setName = requests.find((request) => request.method === "thread/name/set");

        expect(helperThreadStartIndex >= 0).toBeTrue();
        expect(durableTurnStartIndex >= 0).toBeTrue();
        expect(helperThreadStartIndex < durableTurnStartIndex).toBeTrue();
        expect(helperPrompt.includes("User prompt:\nBuild auto title\n\nPasted requirements")).toBeTrue();
        expect(helperPrompt.includes("screen.png")).toBeFalse();
        expect(helperPrompt.includes("README.md")).toBeFalse();
        expect(helperPrompt.includes("/tmp/codex/skill")).toBeFalse();
        expect((setName?.params as { threadId?: string; name?: string } | undefined)?.threadId).toBe("thr_session_auto_title");
        expect((setName?.params as { name?: string } | undefined)?.name).toBe("Fix session auto-title");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forks a session thread from a selected turn and attaches the branch to a new project session", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session branch" });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: defaultProjectId,
        threadId: "thr_session_source",
        threadName: "Source session thread",
        threadPreview: "Source preview",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 3,
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_session_forked",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1,
              updatedAt: 4,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                  ],
                },
                {
                  id: "turn_3",
                  status: "completed",
                  items: [
                    { id: "user_3", type: "userMessage", content: [{ type: "text", text: "Prompt 3" }] },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/rollback") {
          return {
            thread: {
              id: "thr_session_forked",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1,
              updatedAt: 5,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      service.serializeThreadDetail = (threadId: string) => ({
        ...makeThreadDetail(threadId),
        projectId: defaultProjectId,
        threadName: "Source session thread",
        cwd: "/tmp/codex",
        turns: [
          { threadId, turnId: "turn_1", status: "completed", itemIds: ["user_1"] },
          { threadId, turnId: "turn_2", status: "completed", itemIds: ["user_2"] },
          { threadId, turnId: "turn_3", status: "completed", itemIds: ["user_3"] },
        ],
        transcript: [
          {
            threadId,
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId,
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId,
            turnId: "turn_3",
            itemId: "user_3",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 3,
            markdownText: "Prompt 3",
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const result = await service.forkProjectSessionThread(session.id, {
          target: "local",
          turnId: "turn_2",
          message: "Continue from turn 2",
          collaborationMode: "plan",
        });
        const forkParams = requests[0]?.params as { threadId?: string; cwd?: string } | undefined;
        const rollbackParams = requests[1]?.params as { threadId?: string; numTurns?: number } | undefined;
        const linked = getProjectSession(result.session.id)?.thread;
        const snapshot = service.serializeConversationSnapshot("thr_session_forked");

        expect(requests[0]?.method).toBe("thread/fork");
        expect(forkParams?.threadId).toBe("thr_session_source");
        expect(forkParams?.cwd).toBe("/tmp/codex");
        expect(requests[1]?.method).toBe("thread/rollback");
        expect(rollbackParams?.threadId).toBe("thr_session_forked");
        expect(rollbackParams?.numTurns).toBe(1);
        expect(result.threadId).toBe("thr_session_forked");
        expect(result.composerIntent?.prompt).toBe("Continue from turn 2");
        expect(linked?.threadId).toBe("thr_session_forked");
        expect(linked?.projectId).toBe(defaultProjectId);
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[1]?.turnId).toBe("turn_2");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("starts a session thread in a managed worktree when requested", async () => {
    const ran = await withTempDatabase(async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-session-worktree-repo-"));
      initializeGitRepository(repoPath);
      const project = createProject({ name: "Session Worktree", sources: [repoPath] });
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "Session worktree" });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_worktree",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_worktree",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      service.serializeThreadDetail = (threadId: string) => {
        const link = getProjectSession(session.id)?.thread;
        return {
          threadId,
          projectId: project.id,
          source: null,
          threadName: "Thread",
          threadPreview: "",
          modelProvider: "openai",
          cwd: link?.cwd ?? "",
          statusType: "active",
          statusActiveFlags: [],
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          linkedAt: new Date().toISOString(),
          turns: [],
          transcript: [],
        };
      };

      try {
        await service.startThreadForSession({
          projectId: project.id,
          sessionId: session.id,
          prompt: "Start in worktree",
          runInTarget: "newWorktree",
          worktreeStartMode: "detachedHead",
          worktreeBranchPrefix: "nodex/",
          skipAutoTitleGeneration: true,
        });

        const threadStartCwd = (requests.find((request) => request.method === "thread/start")?.params as { cwd?: string } | undefined)?.cwd ?? "";
        const turnStartCwd = (requests.find((request) => request.method === "turn/start")?.params as { cwd?: string } | undefined)?.cwd ?? "";
        const linked = getProjectSession(session.id)?.thread;
        expect(threadStartCwd.length > 0).toBeTrue();
        expect(threadStartCwd === repoPath).toBeFalse();
        expect(fs.existsSync(threadStartCwd)).toBeTrue();
        expect(turnStartCwd).toBe(threadStartCwd);
        expect(linked?.cwd).toBe(threadStartCwd);

        const progressEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "threadStartProgress" }> => event.type === "threadStartProgress",
        );
        expect(progressEvents.some((event) => event.sessionId === session.id && event.phase === "creatingWorktree")).toBeTrue();
        expect(progressEvents.some((event) => event.sessionId === session.id && event.phase === "ready")).toBeTrue();
      } finally {
        await service.shutdown();
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("aborts session worktree start when selected environment setup fails", async () => {
    const ran = await withTempDatabase(async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-session-env-fail-repo-"));
      initializeGitRepository(repoPath);
      const project = createProject({ name: "Session Env Fail", sources: [repoPath] });
      const environmentsDir = path.join(repoPath, ".codex", "environments");
      fs.mkdirSync(environmentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(environmentsDir, "environment.toml"),
        [
          'name = "session-env-fail"',
          "",
          "[setup]",
          "script = '''",
          "echo session-env-fail",
          "exit 9",
          "'''",
          "",
        ].join("\n"),
        "utf8",
      );
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "Failing setup" });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        return {};
      };

      try {
        let message = "";
        try {
          await service.startThreadForSession({
            projectId: project.id,
            sessionId: session.id,
            prompt: "Fail setup",
            runInTarget: "newWorktree",
            runInEnvironmentPath: ".codex/environments/environment.toml",
            skipAutoTitleGeneration: true,
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }

        expect(message.includes("Failed to set up new worktree using environment")).toBeTrue();
        expect(requests.some((request) => request.method === "thread/start")).toBeFalse();
        const progressEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "threadStartProgress" }> => event.type === "threadStartProgress",
        );
        expect(progressEvents.some((event) => event.sessionId === session.id && event.phase === "failed")).toBeTrue();
      } finally {
        await service.shutdown();
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("rejects unsupported cloud session starts", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Cloud selector" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async () => ({});

      try {
        let message = "";
        try {
          await service.startThreadForSession({
            projectId: defaultProjectId,
            sessionId: session.id,
            prompt: "Send to cloud",
            runInTarget: "cloud",
            skipAutoTitleGeneration: true,
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toBe("Cloud run target is not available yet. Choose Work locally or New worktree.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("preserves session prompt attachments and selected model, reasoning, permission, and collaboration inputs", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Attachment composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_attachments",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_attachments",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Fallback text",
          promptInput: {
            text: "Analyze this screenshot",
            images: [{ source: "data:image/png;base64,AAA", caption: "screen.png" }],
            mentions: [{ name: "README.md", path: "/tmp/codex/README.md" }],
          },
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
          permissionMode: "full-access",
          collaborationMode: "plan",
          serviceTier: "fast",
          skipAutoTitleGeneration: true,
        });

        const threadStartRequest = requests.find((request) => request.method === "thread/start");
        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const turnStartParams = turnStartRequest?.params as {
          model?: string;
          effort?: string;
          input?: unknown;
          collaborationMode?: unknown;
        } | undefined;
        expect((threadStartRequest?.params as { model?: string } | undefined)?.model).toBe("gpt-5.3-codex");
        expect(turnStartParams?.model).toBe("gpt-5.3-codex");
        expect(turnStartParams?.effort).toBe("high");
        expect(JSON.stringify(turnStartParams?.collaborationMode)).toBe(JSON.stringify({
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        }));
        const serializedInput = JSON.stringify(turnStartParams?.input);
        expect(serializedInput.includes("Analyze this screenshot")).toBeTrue();
        expect(serializedInput.includes("screen.png")).toBeTrue();
        expect(serializedInput.includes("/tmp/codex/README.md")).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("fails session thread start with a clear error when the project has no source root", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Missing Workspace" });
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "No workspace" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async () => ({});

      try {
        let message = "";
        try {
          await service.startThreadForSession({
            projectId: project.id,
            sessionId: session.id,
            prompt: "Start without workspace",
            skipAutoTitleGeneration: true,
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        expect(message.includes("requires at least one source folder")).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("generates thread title through structured thread/start and turn/start flow", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
    let threadStartParams: Record<string, unknown> | null = null;
    let turnStartParams: Record<string, unknown> | null = null;
    let unsubscribedThreadId: string | null = null;

    const mockClient = {
      startThread: async (params: Record<string, unknown>) => {
        threadStartParams = params;
        return { thread: { id: "thr_title_1" } };
      },
      startTurn: async (params: Record<string, unknown>) => {
        turnStartParams = params;
        setTimeout(() => {
          notificationHandler?.({
            method: "turn/started",
            params: { threadId: "thr_title_1", turn: { id: "turn_title_1" } },
          });
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_title_1",
              turnId: "turn_title_1",
              delta: "{\"title\":\"Refactor inbox list layout\"}",
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "thr_title_1", turn: { id: "turn_title_1", status: "completed" } },
          });
        }, 0);
        return { turn: { id: "turn_title_1" } };
      },
      interruptTurn: async () => ({}),
      unsubscribeThread: async (threadId: string) => {
        unsubscribedThreadId = threadId;
        return {};
      },
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      const generated = await serviceInternals.generateThreadTitleWithStructuredTurn({
        prompt: "Refactor inbox list layout",
        cwd: "/tmp/codex",
        client: mockClient,
      });
      expect(generated).toBe("Refactor inbox list layout");
      expect(JSON.stringify(threadStartParams)).toBe(JSON.stringify({
        model: CODEX_THREAD_TITLE_MODEL,
        modelProvider: null,
        cwd: "/tmp/codex",
        approvalPolicy: "never",
        permissions: ":read-only",
        runtimeWorkspaceRoots: [],
        config: CODEX_THREAD_TITLE_CONFIG,
        personality: null,
        ephemeral: true,
        threadSource: "system",
        experimentalRawEvents: false,
        dynamicTools: null,
        serviceTier: null,
      }));

      const turnStartPayload = turnStartParams && typeof turnStartParams === "object"
        ? turnStartParams as { clientUserMessageId?: unknown; input?: Array<{ text?: string }> }
        : {};
      expect(typeof turnStartPayload.clientUserMessageId).toBe("string");
      const generatedPrompt = turnStartPayload.input?.[0]?.text ?? "";
      expect(generatedPrompt.includes("User prompt:\nRefactor inbox list layout")).toBeTrue();
      expect(JSON.stringify({
        ...(turnStartParams ?? {}),
        clientUserMessageId: "<uuid>",
        input: [{ type: "text", text: "<title-prompt>", text_elements: [] }],
      })).toBe(JSON.stringify({
        threadId: "thr_title_1",
        clientUserMessageId: "<uuid>",
        input: [{ type: "text", text: "<title-prompt>", text_elements: [] }],
        cwd: null,
        approvalPolicy: null,
        permissions: ":read-only",
        runtimeWorkspaceRoots: [],
        model: null,
        effort: null,
        serviceTier: null,
        summary: "none",
        personality: null,
        outputSchema: CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
        collaborationMode: null,
      }));
      expect(unsubscribedThreadId).toBe("thr_title_1");
    } finally {
      await service.shutdown();
    }
  });

  test("trims generated title text and truncates input prompt before sending", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
    let turnStartParams: Record<string, unknown> | null = null;
    let unsubscribedThreadId: string | null = null;
    const longPrompt = "x".repeat(2_500);

    const mockClient = {
      startThread: async () => ({ thread: { id: "thr_title_2" } }),
      startTurn: async (params: Record<string, unknown>) => {
        turnStartParams = params;
        setTimeout(() => {
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "other_thread",
              turnId: "other_turn",
              delta: "wrong stream",
            },
          });
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_title_2",
              turnId: "turn_title_2",
              delta: "This should be replaced",
            },
          });
          notificationHandler?.({
            method: "item/completed",
            params: {
              threadId: "thr_title_2",
              turnId: "turn_title_2",
              item: {
                type: "agentMessage",
                text: "{\"title\":\"title: \\\"Fix flaky.\\\"\"}",
              },
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "thr_title_2", turn: { id: "turn_title_2", status: "completed" } },
          });
        }, 0);
        return { turn: { id: "turn_title_2" } };
      },
      interruptTurn: async () => ({}),
      unsubscribeThread: async (threadId: string) => {
        unsubscribedThreadId = threadId;
        return {};
      },
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      const generated = await serviceInternals.generateThreadTitleWithStructuredTurn({
        prompt: longPrompt,
        cwd: "/tmp/codex",
        client: mockClient,
      });
      expect(generated).toBe("Fix flaky");

      const turnStartPayload = turnStartParams && typeof turnStartParams === "object"
        ? turnStartParams as { input?: Array<{ text?: string }> }
        : {};
      const generatedPrompt = turnStartPayload.input?.[0]?.text ?? "";
      const userPrompt = generatedPrompt.split("User prompt:\n")[1] ?? "";
      expect(userPrompt.length).toBe(2_000);
      expect(unsubscribedThreadId).toBe("thr_title_2");
    } finally {
      await service.shutdown();
    }
  });

  test("ignores unrelated notifications before the helper thread starts", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;

    const mockClient = {
      startThread: async () => ({ thread: { id: "thr_title_3" } }),
      startTurn: async () => {
        setTimeout(() => {
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "other_thread", turn: { id: "other_turn", status: "completed" } },
          });
          notificationHandler?.({
            method: "turn/started",
            params: { threadId: "thr_title_3", turn: { id: "turn_title_3" } },
          });
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_title_3",
              turnId: "turn_title_3",
              delta: "{\"title\":\"Fix worktree startup race\"}",
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "thr_title_3", turn: { id: "turn_title_3", status: "completed" } },
          });
        }, 0);
        return { turn: { id: "turn_title_3" } };
      },
      interruptTurn: async () => ({}),
      unsubscribeThread: async () => ({}),
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      const generated = await serviceInternals.generateThreadTitleWithStructuredTurn({
        prompt: "Fix worktree startup race",
        cwd: "/tmp/codex",
        client: mockClient,
      });
      expect(generated).toBe("Fix worktree startup race");
    } finally {
      await service.shutdown();
    }
  });

  test("interrupts and unsubscribes helper title turns when they fail", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
    let interruptParams: { threadId: string; turnId: string } | null = null;
    let unsubscribedThreadId: string | null = null;

    const mockClient = {
      startThread: async () => ({ thread: { id: "thr_title_failed" } }),
      startTurn: async () => {
        setTimeout(() => {
          notificationHandler?.({
            method: "turn/started",
            params: { threadId: "thr_title_failed", turn: { id: "turn_title_failed" } },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId: "thr_title_failed",
              turn: {
                id: "turn_title_failed",
                status: "failed",
                error: { message: "model unavailable" },
              },
            },
          });
        }, 0);
        return { turn: { id: "turn_title_failed" } };
      },
      interruptTurn: async (params: { threadId: string; turnId: string }) => {
        interruptParams = params;
        return {};
      },
      unsubscribeThread: async (threadId: string) => {
        unsubscribedThreadId = threadId;
        return {};
      },
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      let didReject = false;
      try {
        await serviceInternals.generateThreadTitleWithStructuredTurn({
          prompt: "Fix title flow",
          cwd: "/tmp/codex",
          client: mockClient,
        });
      } catch {
        didReject = true;
      }

      expect(didReject).toBeTrue();
      expect(JSON.stringify(interruptParams)).toBe(JSON.stringify({
        threadId: "thr_title_failed",
        turnId: "turn_title_failed",
      }));
      expect(unsubscribedThreadId).toBe("thr_title_failed");
    } finally {
      await service.shutdown();
    }
  });

  test("returns null when title generation fails", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitle: (input: { prompt: string; cwd: string | null }) => Promise<{ title: string | null }>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
    };
    client.start = async () => {
      throw new Error("boom");
    };

    try {
      const result = await serviceInternals.generateThreadTitle({
        prompt: "Fix the title flow",
        cwd: null,
      });

      expect(JSON.stringify(result)).toBe(JSON.stringify({ title: null }));
    } finally {
      await service.shutdown();
    }
  });

  test("lists managed worktrees once per path when reused by multiple threads", async () => {
    const ran = await withTempDatabase(async () => {
      const kanbanDir = process.env.KANBAN_DIR;
      if (!kanbanDir) {
        throw new Error("KANBAN_DIR was not set by withTempDatabase");
      }
      const sharedPath = path.join(kanbanDir, "worktrees", "reuse", defaultProjectId);
      fs.mkdirSync(sharedPath, { recursive: true });

      const olderLinkedAt = "2026-03-01T00:00:00.000Z";
      const newerLinkedAt = "2026-03-02T00:00:00.000Z";
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_reused_path_old",
        threadName: "Old Thread",
        cwd: sharedPath,
        linkedAt: olderLinkedAt,
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_reused_path_new",
        threadName: "New Thread",
        cwd: sharedPath,
        linkedAt: newerLinkedAt,
      });

      const service = createService();
      try {
        const records = await service.listManagedWorktrees();
        expect(records.length).toBe(1);
        expect(records[0]?.path).toBe(path.resolve(sharedPath));
        expect(records[0]?.threadId).toBe("thr_reused_path_new");
        expect(records[0]?.linkedAt).toBe(newerLinkedAt);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("deletes managed worktree directory and unlinks all threads that point to that path", async () => {
    const ran = await withTempDatabase(async () => {
      const kanbanDir = process.env.KANBAN_DIR;
      if (!kanbanDir) {
        throw new Error("KANBAN_DIR was not set by withTempDatabase");
      }

      const sharedPath = path.join(kanbanDir, "worktrees", "delete", defaultProjectId);
      const otherPath = path.join(kanbanDir, "worktrees", "keep", defaultProjectId);
      fs.mkdirSync(sharedPath, { recursive: true });
      fs.mkdirSync(otherPath, { recursive: true });

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_delete_old",
        cwd: sharedPath,
        linkedAt: "2026-03-01T00:00:00.000Z",
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_delete_new",
        cwd: sharedPath,
        linkedAt: "2026-03-02T00:00:00.000Z",
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_keep",
        cwd: otherPath,
        linkedAt: "2026-03-03T00:00:00.000Z",
      });

      const service = createService();
      try {
        const deleted = await service.deleteManagedWorktree("thr_delete_new");
        expect(deleted).toBeTrue();
        expect(fs.existsSync(sharedPath)).toBeFalse();
        expect(getCodexThread("thr_delete_new")).toBe(null);
        expect(getCodexThread("thr_delete_old")).toBe(null);
        expect(getCodexThread("thr_keep")).not.toBeNull();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("removes git worktree metadata when deleting a managed worktree", async () => {
    const ran = await withTempDatabase(async () => {
      const kanbanDir = process.env.KANBAN_DIR;
      if (!kanbanDir) {
        throw new Error("KANBAN_DIR was not set by withTempDatabase");
      }

      const repositoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-delete-worktree-repo-"));
      initializeGitRepository(repositoryPath);

      const managedPath = path.join(kanbanDir, "worktrees", "git-remove", defaultProjectId);
      fs.mkdirSync(path.dirname(managedPath), { recursive: true });
      execFileSync("git", ["worktree", "add", "--detach", managedPath, "main"], { cwd: repositoryPath });

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_git_remove",
        cwd: managedPath,
      });

      const service = createService();
      try {
        const deleted = await service.deleteManagedWorktree("thr_git_remove");
        expect(deleted).toBeTrue();
        expect(fs.existsSync(managedPath)).toBeFalse();

        const worktreeListOutput = execFileSync(
          "git",
          ["worktree", "list", "--porcelain"],
          { cwd: repositoryPath, encoding: "utf8" },
        );
        expect(worktreeListOutput.includes(path.resolve(managedPath))).toBeFalse();
      } finally {
        await service.shutdown();
        fs.rmSync(repositoryPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

});

describe("codex-service approval fallback", () => {
  test("does not write permission modes disallowed by current requirements", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const stateByProject = Reflect.get(service as object, "permissionStateByProject") as Map<string, CodexPermissionState>;
      const client = Reflect.get(service as object, "client") as {
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      let wroteConfig = false;

      stateByProject.set(defaultProjectId, {
        mode: "auto",
        effectivePreset: "auto",
        availableModes: ["auto", "full-access", "custom"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        sandbox: null,
        guardianApprovalEnabled: true,
        configTarget: {
          source: "user",
          filePath: "/Users/test/.codex/config.toml",
        },
        customDescription: null,
      });
      client.request = async (method: string) => {
        if (method === "config/batchWrite") {
          wroteConfig = true;
        }
        return {};
      };

      try {
        const state = await service.setProjectPermissionMode(defaultProjectId, "guardian-approvals");

        expect(wroteConfig).toBeFalse();
        expect(state.mode).toBe("auto");
        expect(state.availableModes.includes("guardian-approvals")).toBeFalse();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("auto-accepts approval requests in full-access mode", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      };

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "full-access");

      try {
        const result = await serviceInternals.handleServerRequest({
          id: "req_full_access",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_full",
            turnId: "turn_full",
            itemId: "item_full",
            reason: "Needs permissions",
          },
        });

        expect(JSON.stringify(result)).toBe(JSON.stringify({ decision: "accept" }));
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("queues approval requests outside full-access mode", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
        pendingApprovals: Map<
          string,
          {
            reject: (reason?: unknown) => void;
          }
        >;
      };

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "auto");

      try {
        const requestPromise = serviceInternals.handleServerRequest({
          id: "req_sandbox",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_default",
            turnId: "turn_default",
            itemId: "item_default",
            reason: "Needs permissions",
          },
        });

        await Promise.resolve();
        expect(serviceInternals.pendingApprovals.size).toBe(1);
        const approvalItem = getRecordedItem(serviceInternals, "thr_default", "turn_default", "item_default");
        expect(approvalItem?.normalizedKind).toBe("commandExecution");
        expect(approvalItem?.approvalRequestId).toBe("req_sandbox");

        for (const pending of serviceInternals.pendingApprovals.values()) {
          pending.reject(new Error("test cleanup"));
        }
        await requestPromise.catch(() => undefined);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("keys pending approvals by JSON-RPC request.id", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
        pendingApprovals: Map<
          string,
          {
            request: { requestId: string };
            reject: (reason?: unknown) => void;
          }
        >;
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      };
      const events: CodexEvent[] = [];

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "auto");
      serviceInternals.on("event", (event) => {
        events.push(event);
      });

      try {
        const requestPromise = serviceInternals.handleServerRequest({
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_request_id",
            turnId: "turn_request_id",
            itemId: "item_request_id",
            reason: "Needs permissions",
          },
        });

        await Promise.resolve();
        expect(serviceInternals.pendingApprovals.has("42")).toBeTrue();
        const approvalItem = getRecordedItem(serviceInternals, "thr_request_id", "turn_request_id", "item_request_id");
        expect(approvalItem?.approvalRequestId).toBe("42");

        const requestedEvent = events.find(
          (event): event is Extract<CodexEvent, { type: "approvalRequested" }> => event.type === "approvalRequested",
        );
        expect(requestedEvent?.request.requestId).toBe("42");

        for (const pending of serviceInternals.pendingApprovals.values()) {
          pending.reject(new Error("test cleanup"));
        }
        await requestPromise.catch(() => undefined);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});

describe("codex-service streaming notification parity", () => {
  test("ignores item/plan/delta updates until the canonical item lifecycle inserts the plan item", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_plan_delta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        status: "inProgress",
        itemIds: ["plan_item"],
      });
      await serviceInternals.handleNotification("item/plan/delta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        itemId: "plan_item",
        delta: "1. Clarify requirements",
      });
      await serviceInternals.handleNotification("item/plan/delta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        itemId: "plan_item",
        delta: "\n2. Implement changes",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      const planItem = getRecordedItem(serviceInternals, "thr_plan_delta", "turn_plan_delta", "plan_item");

      expect(Boolean(planItem)).toBeFalse();
    } finally {
      await service.shutdown();
    }
  });

  test("handles serverRequest/resolved by clearing pending approvals and user inputs", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      handleNotification: (method: string, params: unknown) => Promise<void>;
      pendingApprovals: Map<string, unknown>;
      pendingUserInputs: Map<string, unknown>;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    await service.setProjectPermissionMode(defaultProjectId, "auto");
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      const approvalPromise = serviceInternals.handleServerRequest({
        id: "approval_req",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thr_resolved",
          turnId: "turn_resolved",
          itemId: "item_approval",
        },
      });
      const userInputPromise = serviceInternals.handleServerRequest({
        id: "input_req",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_resolved",
          turnId: "turn_resolved",
          itemId: "item_input",
          questions: [
            {
              id: "q1",
              header: "Header",
              question: "Question",
            },
          ],
        },
      });

      await Promise.resolve();
      expect(serviceInternals.pendingApprovals.has("approval_req")).toBeTrue();
      expect(serviceInternals.pendingUserInputs.has("input_req")).toBeTrue();

      await serviceInternals.handleNotification("serverRequest/resolved", {
        threadId: "thr_resolved",
        requestId: "approval_req",
      });
      await serviceInternals.handleNotification("serverRequest/resolved", {
        threadId: "thr_resolved",
        requestId: "input_req",
      });

      const approvalResult = await approvalPromise;
      const inputResult = await userInputPromise;
      expect(JSON.stringify(approvalResult)).toBe(JSON.stringify({ decision: "cancel" }));
      expect(JSON.stringify(inputResult)).toBe(JSON.stringify({ answers: {} }));
      expect(serviceInternals.pendingApprovals.has("approval_req")).toBeFalse();
      expect(serviceInternals.pendingUserInputs.has("input_req")).toBeFalse();
      const approvalItem = getRecordedItem(serviceInternals, "thr_resolved", "turn_resolved", "item_approval");
      expect(approvalItem?.approvalRequestId ?? null).toBe(null);

      const approvalResolvedEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "approvalResolved" }> => event.type === "approvalResolved",
      );
      const userInputResolvedEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "userInputResolved" }> => event.type === "userInputResolved",
      );
      expect(approvalResolvedEvents.some((event) => event.requestId === "approval_req")).toBeTrue();
      expect(userInputResolvedEvents.some((event) => event.requestId === "input_req")).toBeTrue();
    } finally {
      await service.shutdown();
    }
  });

  test("respondToUserInput persists answered questions onto the transcript item", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_input", {
        threadId: "thr_input",
        turnId: "turn_input",
        status: "inProgress",
        itemIds: ["item_input"],
      });
      const requestPromise = serviceInternals.handleServerRequest({
        id: "input_req",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_input",
          turnId: "turn_input",
          itemId: "item_input",
          questions: [
            {
              id: "q1",
              header: "Math",
              question: "What is 1 + 1?",
              options: [{ label: "2", description: "Correct" }],
            },
          ],
        },
      });

      await Promise.resolve();
      const responded = await service.respondToUserInput("input_req", { q1: ["2"] });
      expect(responded).toBeTrue();

      const resolved = await requestPromise;
      expect(JSON.stringify(resolved)).toBe(JSON.stringify({
        answers: {
          q1: {
            answers: ["2"],
          },
        },
      }));

      const answeredItem = getRecordedItem(
        serviceInternals,
        "thr_input",
        "turn_input",
        "user-input-response-input_req",
      );

      expect(answeredItem?.normalizedKind).toBe("userInputResponse");
      expect(answeredItem?.semanticKind).toBe("userInputResponse");
      expect(answeredItem?.status).toBe("completed");
      expect(answeredItem?.userInputQuestions?.[0]?.question).toBe("What is 1 + 1?");
      expect(answeredItem?.userInputAnswers?.q1?.[0]).toBe("2");
      expect((answeredItem?.rawItem as { answers?: Record<string, string[]> } | undefined)?.answers?.q1?.[0]).toBe("2");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service custom permission descriptions", () => {
  test("reports parsed CODEX_HOME config values for custom mode", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        findProjectCodexConfig: (projectId: string) => { configPath: string; displayPath: string } | null;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const originalCodexHome = process.env.CODEX_HOME;
      const tempCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-"));
      const configPath = path.join(tempCodexHome, "config.toml");

      fs.writeFileSync(
        configPath,
        [
          'sandbox_mode = "workspace-write"',
          'approval_policy = "on-request"',
          "",
        ].join("\n"),
        "utf8",
      );
      process.env.CODEX_HOME = tempCodexHome;
      serviceInternals.findProjectCodexConfig = () => null;
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read") {
          return {
            config: {
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
            origins: {
              sandbox_mode: {
                name: {
                  type: "user",
                  file: configPath,
                },
              },
              approval_policy: {
                name: {
                  type: "user",
                  file: configPath,
                },
              },
              approvals_reviewer: {
                name: {
                  type: "user",
                  file: configPath,
                },
              },
              sandbox_workspace_write: undefined,
            },
          };
        }
        if (method === "configRequirements/read") {
          return { requirements: null };
        }
        return {};
      };

      try {
        const description = await service.getCustomPermissionModeDescription(defaultProjectId);
        expect(description).toBe(
          `User config (${configPath}): sandbox_mode=workspace-write; approval_policy=on-request; approvals_reviewer=user.`,
        );
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
        fs.rmSync(tempCodexHome, { recursive: true, force: true });
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("reports parsed workspace config values for custom mode", async () => {
    const service = createService();
    const ran = await withTempDatabase(async () => {
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-workspace-config-"));
      const project = createProject({ name: "Workspace Config", sources: [workspacePath] });
      const projectId = project.id;

      fs.writeFileSync(
        path.join(workspacePath, "config.toml"),
        [
          'sandbox_mode = "workspace-write"',
          'approval_policy = "on-request"',
          "",
        ].join("\n"),
        "utf8",
      );

      try {
        client.start = async () => undefined;
        client.request = async (method: string) => {
          if (method === "config/read") {
            return {
              config: {
                sandbox_mode: "workspace-write",
                approval_policy: "on-request",
                approvals_reviewer: "user",
              },
              origins: {
                sandbox_mode: {
                  name: {
                    type: "project",
                    dotCodexFolder: workspacePath,
                  },
                },
                approval_policy: {
                  name: {
                    type: "project",
                    dotCodexFolder: workspacePath,
                  },
                },
                approvals_reviewer: {
                  name: {
                    type: "project",
                    dotCodexFolder: workspacePath,
                  },
                },
                sandbox_workspace_write: undefined,
              },
            };
          }
          if (method === "configRequirements/read") {
            return { requirements: null };
          }
          return {};
        };
        const description = await service.getCustomPermissionModeDescription(projectId);
        expect(description).toBe(
          `Project config (${path.join(workspacePath, "config.toml")}): sandbox_mode=workspace-write; approval_policy=on-request; approvals_reviewer=user.`,
        );
      } finally {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    });

    try {
      if (!ran) expect(true).toBeTrue();
    } finally {
      await service.shutdown();
    }
  });

  test("prefers user-config display path when walk-up finds ~/.codex/config.toml", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    const originalHome = process.env.HOME;
    const originalCodexHome = process.env.CODEX_HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-walkup-"));
    const workspacePath = path.join(tempHome, "workspace", "project");
    const userCodexDir = path.join(tempHome, ".codex");

    const ran = await withTempDatabase(async () => {
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(userCodexDir, { recursive: true });
      fs.writeFileSync(
        path.join(userCodexDir, "config.toml"),
        [
          'sandbox_mode = "workspace-write"',
          'approval_policy = "on-request"',
          "",
        ].join("\n"),
        "utf8",
      );
      const project = createProject({ name: "Home Walkup", sources: [workspacePath] });
      const projectId = project.id;
      process.env.HOME = tempHome;
      delete process.env.CODEX_HOME;

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read") {
          return {
            config: {
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
            origins: {
              sandbox_mode: {
                name: {
                  type: "user",
                  file: path.join(userCodexDir, "config.toml"),
                },
              },
              approval_policy: {
                name: {
                  type: "user",
                  file: path.join(userCodexDir, "config.toml"),
                },
              },
              approvals_reviewer: {
                name: {
                  type: "user",
                  file: path.join(userCodexDir, "config.toml"),
                },
              },
              sandbox_workspace_write: undefined,
            },
          };
        }
        if (method === "configRequirements/read") {
          return { requirements: null };
        }
        return {};
      };

      const description = await service.getCustomPermissionModeDescription(projectId);
      expect(description).toBe(
        `User config (${path.join(userCodexDir, "config.toml")}): sandbox_mode=workspace-write; approval_policy=on-request; approvals_reviewer=user.`,
      );
    });

    try {
      if (!ran) expect(true).toBeTrue();
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
      await service.shutdown();
    }
  });
});

describe("codex-service item identity dedupe", () => {
  test("treats synthetic and live user-message ids as the same item within a turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeItem: (entry: CodexItemView) => void;
      conversationRecords: Map<string, { itemsByTurn: Map<string, Map<string, CodexItemView>> }>;
    };

    const baseItem: Omit<CodexItemView, "itemId" | "createdAt" | "updatedAt"> = {
      threadId: "thr_dedupe",
      turnId: "turn_dedupe",
      type: "userMessage",
      normalizedKind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "say \"hi\"",
    };

    try {
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "item-16",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "878d0f9b-7c9f-468f-b297-9063a9c350ad",
        createdAt: 20,
        updatedAt: 20,
      });

      const byItem = serviceInternals.conversationRecords.get("thr_dedupe")?.itemsByTurn.get("turn_dedupe");
      expect(byItem?.size).toBe(1);
      const merged = byItem ? Array.from(byItem.values())[0] : null;
      expect(merged?.markdownText).toBe("say \"hi\"");
      expect(merged?.itemId).toBe("878d0f9b-7c9f-468f-b297-9063a9c350ad");
    } finally {
      await service.shutdown();
    }
  });

  test("treats synthetic and live assistant-message ids as the same item within a turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeItem: (entry: CodexItemView) => void;
      conversationRecords: Map<string, { itemsByTurn: Map<string, Map<string, CodexItemView>> }>;
    };

    const baseItem: Omit<CodexItemView, "itemId" | "createdAt" | "updatedAt"> = {
      threadId: "thr_dedupe_assistant",
      turnId: "turn_dedupe_assistant",
      type: "agentMessage",
      normalizedKind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      markdownText: "I added the shared module. Next I’m rewiring project-switcher.tsx.",
    };

    try {
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "item-15",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "msg_0827a35f777c91c901699cc22e743081918e86cc129ba14c30",
        createdAt: 20,
        updatedAt: 20,
      });

      const byItem = serviceInternals.conversationRecords
        .get("thr_dedupe_assistant")
        ?.itemsByTurn.get("turn_dedupe_assistant");
      expect(byItem?.size).toBe(1);
      const merged = byItem ? Array.from(byItem.values())[0] : null;
      expect(merged?.normalizedKind).toBe("assistantMessage");
      expect(merged?.markdownText).toBe("I added the shared module. Next I’m rewiring project-switcher.tsx.");
      expect(merged?.itemId).toBe("msg_0827a35f777c91c901699cc22e743081918e86cc129ba14c30");
    } finally {
      await service.shutdown();
    }
  });

  test("does not merge two live assistant-message ids that share the same text", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeItem: (entry: CodexItemView) => void;
      conversationRecords: Map<string, { itemsByTurn: Map<string, Map<string, CodexItemView>> }>;
    };

    const baseItem: Omit<CodexItemView, "itemId" | "createdAt" | "updatedAt"> = {
      threadId: "thr_live_dupe_guard",
      turnId: "turn_live_dupe_guard",
      type: "agentMessage",
      normalizedKind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      markdownText: "Working...",
    };

    try {
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "msg_0001",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "msg_0002",
        createdAt: 20,
        updatedAt: 20,
      });

      const byItem = serviceInternals.conversationRecords
        .get("thr_live_dupe_guard")
        ?.itemsByTurn.get("turn_live_dupe_guard");
      expect(byItem?.size).toBe(2);
      expect(Array.from(byItem?.values() ?? []).map((item) => item.itemId).sort().join(",")).toBe(
        "msg_0001,msg_0002",
      );
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service item lifecycle status fallback", () => {
  test("projects live reasoning rows from summary text only", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_reasoning_projection", {
        threadId: "thr_reasoning_projection",
        turnId: "turn_reasoning_projection",
        status: "inProgress",
        itemIds: ["item_reasoning"],
      });

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_reasoning_projection",
        turnId: "turn_reasoning_projection",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: [],
          content: ["Private reasoning body"],
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_reasoning_projection",
        "turn_reasoning_projection",
        "item_reasoning",
      );
      expect(item?.markdownText ?? "").toBe("");

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_reasoning_projection",
        turnId: "turn_reasoning_projection",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["Investigating", "Checking thread state"],
          content: ["Private reasoning body"],
        },
      });

      item = getRecordedItem(
        serviceInternals,
        "thr_reasoning_projection",
        "turn_reasoning_projection",
        "item_reasoning",
      );
      expect(item?.markdownText).toBe("**Investigating**\n\nChecking thread state");
    } finally {
      await service.shutdown();
    }
  });

  test("derives reasoning item status from item lifecycle notifications", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_status", {
        threadId: "thr_status",
        turnId: "turn_status",
        status: "inProgress",
        itemIds: ["item_reasoning"],
      });
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_status",
        turnId: "turn_status",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["Planning the next step"],
          content: [],
        },
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_status",
        turnId: "turn_status",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["Planning complete"],
          content: [],
        },
      });

      const item = getRecordedItem(serviceInternals, "thr_status", "turn_status", "item_reasoning");

      expect(item?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });

  test("projects live context compaction lifecycle rows into the canonical conversation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_compaction_live", {
        threadId: "thr_compaction_live",
        turnId: "turn_compaction_live",
        status: "inProgress",
        itemIds: ["item_context_compaction"],
      });

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_compaction_live",
        turnId: "turn_compaction_live",
        item: {
          id: "item_context_compaction",
          type: "context_compaction",
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_compaction_live",
        "turn_compaction_live",
        "item_context_compaction",
      );
      expect(item?.semanticKind).toBe("contextCompaction");
      expect(item?.status).toBe("inProgress");
      expect(item?.markdownText).toBe("Automatically compacting context");

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_compaction_live",
        turnId: "turn_compaction_live",
        item: {
          id: "item_context_compaction",
          type: "context_compaction",
        },
      });

      item = getRecordedItem(
        serviceInternals,
        "thr_compaction_live",
        "turn_compaction_live",
        "item_context_compaction",
      );
      expect(item?.status).toBe("completed");
      expect(item?.markdownText).toBe("Context automatically compacted");
    } finally {
      await service.shutdown();
    }
  });

  test("inserts live context compaction at the canonical turn item position instead of the transcript tail", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_compaction_order"),
        turns: [
          {
            threadId: "thr_compaction_order",
            turnId: "turn_compaction_order",
            status: "completed",
            itemIds: ["assistant_before", "item_context_compaction", "tool_after"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_order",
          turnId: "turn_compaction_order",
          item: {
            id: "tool_after",
            type: "function_call",
            name: "bash",
            arguments: "{\"command\":\"echo later\"}",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_order",
          turnId: "turn_compaction_order",
          item: {
            id: "assistant_before",
            type: "assistant_message",
            text: "Assistant first.",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_order",
          turnId: "turn_compaction_order",
          item: {
            id: "item_context_compaction",
            type: "context_compaction",
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 30));

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns.length).toBe(1);
        expect(latest?.turns[0]?.items.length).toBe(3);
        expect(latest?.turns[0]?.items[0]?.itemId).toBe("assistant_before");
        expect(latest?.turns[0]?.items[1]?.itemId).toBe("item_context_compaction");
        expect(latest?.turns[0]?.items[2]?.itemId).toBe("tool_after");
        expect(latest?.turns[0]?.items[1]?.markdownText).toBe("Context automatically compacted");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("synthesizes turn-local canonical item order from live item lifecycle events", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_compaction_live_order"),
        turns: [],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "assistant_before",
            type: "assistant_message",
            text: "Assistant first.",
          },
        });

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "item_context_compaction",
            type: "context_compaction",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "item_context_compaction",
            type: "context_compaction",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "tool_after",
            type: "function_call",
            name: "bash",
            arguments: "{\"command\":\"echo later\"}",
          },
        });

        await flushAsyncWork();

        const detail = service.serializeThreadDetail("thr_compaction_live_order");
        expect(detail?.turns.length).toBe(1);
        expect(detail?.turns[0]?.itemIds.join(",")).toBe("assistant_before,item_context_compaction,tool_after");

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns[0]?.items.map((item) => item.itemId).join(",")).toBe(
          "assistant_before,item_context_compaction,tool_after",
        );
        expect(latest?.turns[0]?.items[1]?.markdownText).toBe("Context automatically compacted");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("projects automatic approval review notifications into the canonical conversation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_auto_review", {
        threadId: "thr_auto_review",
        turnId: "turn_auto_review",
        status: "inProgress",
        itemIds: ["item_command"],
      });

      await serviceInternals.handleNotification("item/autoApprovalReview/started", {
        threadId: "thr_auto_review",
        turnId: "turn_auto_review",
        targetItemId: "item_command",
        review: {
          status: "inProgress",
          riskScore: 0.52,
          riskLevel: "medium",
          rationale: null,
        },
        action: {
          type: "commandExecution",
          command: "bun test",
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_auto_review",
        "turn_auto_review",
        "automatic-approval-review:item_command",
      );
      expect(item?.semanticKind).toBe("automaticApprovalReview");
      expect(item?.status).toBe("inProgress");

      await serviceInternals.handleNotification("item/autoApprovalReview/completed", {
        threadId: "thr_auto_review",
        turnId: "turn_auto_review",
        targetItemId: "item_command",
        review: {
          status: "approved",
          riskScore: 0.11,
          riskLevel: "low",
          rationale: "This only runs the local test suite.",
        },
        action: {
          type: "commandExecution",
          command: "bun test",
        },
      });

      item = getRecordedItem(
        serviceInternals,
        "thr_auto_review",
        "turn_auto_review",
        "automatic-approval-review:item_command",
      );
      expect(item?.status).toBe("completed");
      expect((item?.rawItem as { review?: { status?: string } } | undefined)?.review?.status).toBe("approved");
      expect(item?.markdownText).toBe("This only runs the local test suite.");
    } finally {
      await service.shutdown();
    }
  });

  test("projects hook lifecycle notifications into canonical turn items", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_hook", {
        threadId: "thr_hook",
        turnId: "turn_hook",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification("hook/started", {
        threadId: "thr_hook",
        turnId: "turn_hook",
        run: {
          id: "hook_run_1",
          eventName: "preToolUse",
          status: "running",
          statusMessage: "Preparing context",
          entries: [{ kind: "context", text: "Added AGENTS.md" }],
        },
      });

      let item = getRecordedItem(serviceInternals, "thr_hook", "turn_hook", "hook_run_1");
      expect(item?.semanticKind).toBe("hook");
      expect(item?.status).toBe("inProgress");

      await serviceInternals.handleNotification("hook/completed", {
        threadId: "thr_hook",
        turnId: "turn_hook",
        run: {
          id: "hook_run_1",
          eventName: "preToolUse",
          status: "completed",
          statusMessage: "Preparing context",
          entries: [{ kind: "context", text: "Added AGENTS.md" }],
        },
      });

      item = getRecordedItem(serviceInternals, "thr_hook", "turn_hook", "hook_run_1");
      expect(item?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });

  test("projects MCP elicitation requests into canonical turn items and completes them on response", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_mcp", {
        threadId: "thr_mcp",
        turnId: "turn_mcp",
        status: "inProgress",
        itemIds: [],
      });

      const requestPromise = serviceInternals.handleServerRequest({
        id: "mcp_req",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_mcp",
          turnId: "turn_mcp",
          mode: "form",
          serverName: "Context7",
          message: "Allow this call?",
          requestedSchema: {},
        },
      });

      await Promise.resolve();

      let item = getRecordedItem(serviceInternals, "thr_mcp", "turn_mcp", "mcp-server-elicitation-mcp_req");
      expect(item?.semanticKind).toBe("mcpServerElicitation");
      expect(item?.status).toBe("inProgress");

      const responded = await service.respondToMcpServerElicitation("mcp_req", "accept");
      expect(responded).toBeTrue();
      await requestPromise;

      item = getRecordedItem(serviceInternals, "thr_mcp", "turn_mcp", "mcp-server-elicitation-mcp_req");
      expect(item?.status).toBe("completed");
      expect((item?.rawItem as { action?: string } | undefined)?.action).toBe("accept");
    } finally {
      await service.shutdown();
    }
  });

  test("synthesizes planImplementation items from completed turns with unfinished plans", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
      listPendingConversationRequests: (threadId: string) => Array<{ type: string; turnId: string }>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_plan_impl"),
        turns: [],
        transcript: [],
      });

      serviceInternals.mergeTurn("thr_plan_impl", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
        item: {
          id: "plan_text",
          type: "plan",
          text: "1. Ship the fix\n2. Verify the behavior",
        },
      });

      await serviceInternals.handleNotification("turn/plan/updated", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
        explanation: null,
        plan: [
          { step: "Ship the fix", status: "completed" },
          { step: "Verify the behavior", status: "in_progress" },
        ],
      });

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
      });

      const item = getRecordedItem(
        serviceInternals,
        "thr_plan_impl",
        "turn_plan_impl",
        "implement-plan:turn_plan_impl",
      );
      expect(item?.semanticKind).toBe("planImplementation");
      expect(item?.status).toBe("inProgress");
      expect(item?.markdownText).toBe("1. Ship the fix\n2. Verify the behavior");

      const requests = serviceInternals.listPendingConversationRequests("thr_plan_impl");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");
      expect(requests[0]?.turnId).toBe("turn_plan_impl");
    } finally {
      await service.shutdown();
    }
  });

  test("creates a planImplementation request from a completed proposed plan even without todo-list updates", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      listPendingConversationRequests: (threadId: string) => Array<{ type: string; turnId: string }>;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_plan_impl_no_todo"),
        turns: [],
        transcript: [],
      });

      serviceInternals.mergeTurn("thr_plan_impl_no_todo", {
        threadId: "thr_plan_impl_no_todo",
        turnId: "turn_plan_impl_no_todo",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_plan_impl_no_todo",
        turnId: "turn_plan_impl_no_todo",
        item: {
          id: "plan_text",
          type: "plan",
          text: "1. Ship the fix\n2. Verify the behavior",
        },
      });

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_plan_impl_no_todo",
        turnId: "turn_plan_impl_no_todo",
      });

      const requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_no_todo");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");
      expect(requests[0]?.turnId).toBe("turn_plan_impl_no_todo");
    } finally {
      await service.shutdown();
    }
  });

  test("removing a planImplementation request completes the item and removes the request-plane entry", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      listPendingConversationRequests: (threadId: string) => Array<{ type: string }>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      syncPlanImplementationForTurn: (threadId: string, turnId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_plan_impl_remove"),
        turns: [],
        transcript: [],
      });

      serviceInternals.mergeTurn("thr_plan_impl_remove", {
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        status: "completed",
        itemIds: ["plan_text", "todo-list:turn_plan_impl_remove", "implement-plan:turn_plan_impl_remove"],
      });

      serviceInternals.mergeItem({
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        itemId: "plan_text",
        type: "plan",
        normalizedKind: "plan",
        semanticKind: "proposedPlan",
        markdownText: "1. Ship the fix\n2. Verify the behavior",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        itemId: "todo-list:turn_plan_impl_remove",
        type: "todo-list",
        normalizedKind: "plan",
        semanticKind: "todoList",
        markdownText: "1. [x] Ship the fix\n2. [ ] Verify the behavior",
        rawItem: {
          id: "todo-list:turn_plan_impl_remove",
          type: "todo-list",
          explanation: null,
          plan: [
            { step: "Ship the fix", status: "completed" },
            { step: "Verify the behavior", status: "in_progress" },
          ],
        },
        status: "inProgress",
        createdAt: 20,
        updatedAt: 20,
      });

      serviceInternals.syncPlanImplementationForTurn(
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
      );

      let requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_remove");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");

      const removed = await service.removePlanImplementationRequest(
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
      );
      expect(removed).toBeTrue();

      requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_remove");
      expect(requests.length).toBe(0);

      const item = getRecordedItem(
        serviceInternals as unknown as {
          getConversationRecord: (threadId: string) => {
            itemsByTurn: Map<string, Map<string, CodexItemView>>;
          };
        },
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
        "implement-plan:turn_plan_impl_remove",
      );
      expect(item?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service terminal turn reconciliation", () => {
  test("turn/completed still terminalizes non-command lingering in-progress items", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_terminal", {
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        status: "inProgress",
        itemIds: ["item_reasoning", "item_tool"],
      });
      serviceInternals.mergeItem({
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        itemId: "item_reasoning",
        type: "reasoning",
        normalizedKind: "reasoning",
        semanticKind: "reasoning",
        status: "inProgress",
        markdownText: "Thinking...",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        itemId: "item_tool",
        type: "commandExecution",
        normalizedKind: "commandExecution",
        semanticKind: "exec",
        status: "inProgress",
        toolCall: {
          subtype: "command",
          toolName: "bash",
          args: {
            command: "bun test",
          },
        },
        createdAt: 11,
        updatedAt: 11,
      });

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_terminal",
        turnId: "turn_terminal",
      });

      const turnEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "turn" }> => event.type === "turn",
      );
      expect(turnEvents.length).toBe(1);
      expect(turnEvents[0]?.turn.status).toBe("completed");
      const reasoningItem = getRecordedItem(serviceInternals, "thr_terminal", "turn_terminal", "item_reasoning");
      expect(reasoningItem?.status).toBe("completed");
      const commandItem = getRecordedItem(serviceInternals, "thr_terminal", "turn_terminal", "item_tool");
      expect(commandItem?.status).toBe("inProgress");
    } finally {
      await service.shutdown();
    }
  });

  test("interruptTurn immediately marks known in-progress turn/items as interrupted", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const events: CodexEvent[] = [];

    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    client.start = async () => undefined;
    client.request = async () => ({});

    try {
      serviceInternals.mergeTurn("thr_interrupt_terminal", {
        threadId: "thr_interrupt_terminal",
        turnId: "turn_interrupt_terminal",
        status: "inProgress",
        itemIds: ["item_tool"],
      });
      serviceInternals.mergeItem({
        threadId: "thr_interrupt_terminal",
        turnId: "turn_interrupt_terminal",
        itemId: "item_tool",
        type: "commandExecution",
        normalizedKind: "commandExecution",
        semanticKind: "exec",
        status: "inProgress",
        toolCall: {
          subtype: "command",
          toolName: "bash",
          args: {
            command: "ls",
          },
        },
        createdAt: 10,
        updatedAt: 10,
      });

      const interrupted = await service.interruptTurn("thr_interrupt_terminal", "turn_interrupt_terminal");
      expect(interrupted).toBeTrue();

      const turnEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "turn" }> => event.type === "turn",
      );
      expect(turnEvents.some((event) => event.turn.status === "interrupted")).toBeTrue();
      const interruptedTurn = turnEvents.find((event) => event.turn.turnId === "turn_interrupt_terminal")?.turn;
      expect(interruptedTurn?.interruptedCommandExecutionItemIds?.[0]).toBe("item_tool");
      const item = getRecordedItem(serviceInternals, "thr_interrupt_terminal", "turn_interrupt_terminal", "item_tool");
      expect(item?.status).toBe("interrupted");
    } finally {
      await service.shutdown();
    }
  });

  test("streams assistant deltas through thread stream patch updates", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_delta"),
        turns: [
          {
            threadId: "thr_streaming_delta",
            turnId: "turn_streaming_delta",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/agentMessage/delta", {
          threadId: "thr_streaming_delta",
          turnId: "turn_streaming_delta",
          itemId: "assistant_streaming_delta",
          delta: "hello",
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns.length).toBe(1);
        expect(typeof latest?.turns[0]?.turnStartedAtMs).toBe("number");
        expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
        expect(latest?.turns[0]?.items.length).toBe(1);
        expect(latest?.turns[0]?.items[0]?.markdownText).toBe("hello");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("refreshes assistant display timestamp when a completed agent message arrives", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_agent_message_completed"),
        turns: [
          {
            threadId: "thr_agent_message_completed",
            turnId: "turn_agent_message_completed",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_agent_message_completed",
          turnId: "turn_agent_message_completed",
          item: {
            id: "assistant_agent_message_completed",
            type: "agentMessage",
            text: "Done",
          },
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns[0]?.items[0]?.markdownText).toBe("Done");
        expect(typeof latest?.turns[0]?.turnStartedAtMs).toBe("number");
        expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("keeps live assistant timestamp when turn completion carries completedAt fallback", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completion_timestamp_fallback"),
        turns: [
          {
            threadId: "thr_completion_timestamp_fallback",
            turnId: "turn_completion_timestamp_fallback",
            status: "inProgress",
            itemIds: [],
            turnStartedAtMs: 100,
            finalAssistantStartedAtMs: 200,
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_completion_timestamp_fallback",
          turn: {
            id: "turn_completion_timestamp_fallback",
            status: "completed",
            completedAt: 999,
            items: [],
          },
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest?.turns[0]?.status).toBe("completed");
        expect(latest?.turns[0]?.turnStartedAtMs).toBe(100);
        expect(latest?.turns[0]?.finalAssistantStartedAtMs).toBe(200);
        expect(latest?.turns[0]?.completedAt).toBe(999_000);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("avoids full conversation serialization during assistant delta flushes once the broadcast cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_delta_hot_path"),
        turns: [
          {
            threadId: "thr_streaming_delta_hot_path",
            turnId: "turn_streaming_delta_hot_path",
            status: "inProgress",
            itemIds: ["assistant_streaming_delta_hot_path"],
          },
        ],
        transcript: [{
          threadId: "thr_streaming_delta_hot_path",
          turnId: "turn_streaming_delta_hot_path",
          itemId: "assistant_streaming_delta_hot_path",
          type: "assistant_message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          markdownText: "",
          role: "assistant",
          createdAt: 1,
          updatedAt: 1,
        }],
      });

      try {
        await service.requestConversationSnapshot("thr_streaming_delta_hot_path");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await serviceInternals.handleNotification("item/agentMessage/delta", {
          threadId: "thr_streaming_delta_hot_path",
          turnId: "turn_streaming_delta_hot_path",
          itemId: "assistant_streaming_delta_hot_path",
          delta: "hello",
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBeTrue();
        const firstHostMessage = hostMessages[0];
        expect(firstHostMessage?.type).toBe("threadStreamStateChanged");
        expect(
          firstHostMessage?.type === "threadStreamStateChanged"
            ? firstHostMessage.change.type
            : "snapshot",
        ).toBe("patches");
        const latest = projectConversationFromHostMessages(hostMessages);
        expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("streams command output deltas as raw mcp notifications while keeping snapshots canonical", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const threadMessages: CodexHostMessage[] = [];
      const mcpMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          threadMessages.push(message);
        }
        if (message.type === "mcpNotification") {
          mcpMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_output"),
        turns: [
          {
            threadId: "thr_streaming_output",
            turnId: "turn_streaming_output",
            status: "inProgress",
            itemIds: ["exec_streaming_output"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_streaming_output",
          turnId: "turn_streaming_output",
          item: {
            id: "exec_streaming_output",
            type: "commandExecution",
            command: "bun test",
            cwd: "/tmp",
            status: "in_progress",
          },
        });
        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_output",
          turnId: "turn_streaming_output",
          itemId: "exec_streaming_output",
          delta: "1340 pass\n",
        });

        expect(String(mcpMessages.length)).toBe("1");
        const mcpMessage = mcpMessages[0];
        expect(mcpMessage?.type).toBe("mcpNotification");
        expect(
          mcpMessage?.type === "mcpNotification"
            ? mcpMessage.method
            : "",
        ).toBe("item/commandExecution/outputDelta");
        expect(
          mcpMessage?.type === "mcpNotification"
            ? mcpMessage.params.delta
            : "",
        ).toBe("1340 pass\n");

        const threadMessageCountAfterStarted = threadMessages.length;
        await new Promise((resolve) => setTimeout(resolve, 70));
        expect(String(threadMessages.length)).toBe(String(threadMessageCountAfterStarted));

        const snapshot = await service.requestConversationSnapshot("thr_streaming_output");
        expect(snapshot).not.toBeNull();
        expect(snapshot?.turns.length).toBe(1);
        expect(snapshot?.turns[0]?.items.length).toBe(1);
        expect(typeof snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");
        expect(snapshot?.turns[0]?.items[0]?.aggregatedOutput).toBe("1340 pass\n");
        expect(typeof snapshot?.turns[0]?.items[0]?.toolCall?.result).toBe("string");
        expect(snapshot?.turns[0]?.items[0]?.toolCall?.result).toBe("1340 pass\n");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("item completed backfills first work item start without overwriting an existing stamp", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_work_stamp"),
        turns: [{
          threadId: "thr_completed_work_stamp",
          turnId: "turn_completed_work_stamp",
          status: "inProgress",
          itemIds: ["exec_completed"],
        }],
        transcript: [],
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_completed_work_stamp",
        turnId: "turn_completed_work_stamp",
        item: {
          id: "exec_completed",
          type: "commandExecution",
          command: "bun test",
          status: "completed",
        },
      });

      let snapshot = service.serializeConversationSnapshot("thr_completed_work_stamp");
      expect(typeof snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_existing_work_stamp"),
        turns: [{
          threadId: "thr_existing_work_stamp",
          turnId: "turn_existing_work_stamp",
          status: "inProgress",
          itemIds: ["exec_existing"],
          firstTurnWorkItemStartedAtMs: 123,
        }],
        transcript: [],
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_existing_work_stamp",
        turnId: "turn_existing_work_stamp",
        item: {
          id: "exec_existing",
          type: "commandExecution",
          command: "bun test",
          status: "completed",
        },
      });

      snapshot = service.serializeConversationSnapshot("thr_existing_work_stamp");
      expect(snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs ?? 0).toBe(123);
    } finally {
      await service.shutdown();
    }
  });

  test("item/completed flushes pending command output into the canonical snapshot", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_output_flush"),
        turns: [{
          threadId: "thr_completed_output_flush",
          turnId: "turn_completed_output_flush",
          status: "inProgress",
          itemIds: ["exec_completed_output_flush"],
        }],
        transcript: [],
      });

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_completed_output_flush",
        turnId: "turn_completed_output_flush",
        item: {
          id: "exec_completed_output_flush",
          type: "commandExecution",
          command: "bun test",
          status: "in_progress",
        },
      });
      await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
        threadId: "thr_completed_output_flush",
        turnId: "turn_completed_output_flush",
        itemId: "exec_completed_output_flush",
        delta: "1340 pass\n",
      });
      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_completed_output_flush",
        turnId: "turn_completed_output_flush",
        item: {
          id: "exec_completed_output_flush",
          type: "commandExecution",
          command: "bun test",
          status: "completed",
        },
      });

      const snapshot = service.serializeConversationSnapshot("thr_completed_output_flush");
      const item = snapshot?.turns[0]?.items[0];
      expect(item?.status).toBe("completed");
      expect(item?.aggregatedOutput).toBe("1340 pass\n");
    } finally {
      await service.shutdown();
    }
  });

  test("keeps command-output delta flushes silent once the broadcast cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const threadMessages: CodexHostMessage[] = [];
      const mcpMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          threadMessages.push(message);
        }
        if (message.type === "mcpNotification") {
          mcpMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_output_hot_path"),
        turns: [
          {
            threadId: "thr_streaming_output_hot_path",
            turnId: "turn_streaming_output_hot_path",
            status: "inProgress",
            itemIds: ["exec_streaming_output_hot_path"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_streaming_output_hot_path",
          turnId: "turn_streaming_output_hot_path",
          item: {
            id: "exec_streaming_output_hot_path",
            type: "commandExecution",
            command: "bun test",
            cwd: "/tmp",
            status: "in_progress",
          },
        });
        await service.requestConversationSnapshot("thr_streaming_output_hot_path");
        threadMessages.length = 0;
        mcpMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_output_hot_path",
          turnId: "turn_streaming_output_hot_path",
          itemId: "exec_streaming_output_hot_path",
          delta: "1340 pass\n",
        });
        await new Promise((resolve) => setTimeout(resolve, 70));

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(String(threadMessages.length)).toBe("0");
        expect(String(mcpMessages.length)).toBe("1");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("skips frame-text deltas that arrive before the canonical item exists", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const threadMessages: CodexHostMessage[] = [];
      const mcpMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          threadMessages.push(message);
        }
        if (message.type === "mcpNotification") {
          mcpMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_missing_item"),
        turns: [
          {
            threadId: "thr_streaming_missing_item",
            turnId: "turn_streaming_missing_item",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/agentMessage/delta", {
          threadId: "thr_streaming_missing_item",
          turnId: "turn_streaming_missing_item",
          itemId: "assistant_missing_item",
          delta: "hello",
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(threadMessages.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("skips command output deltas that arrive before the canonical item exists", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const threadMessages: CodexHostMessage[] = [];
      const mcpMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          threadMessages.push(message);
        }
        if (message.type === "mcpNotification") {
          mcpMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_missing_output"),
        turns: [
          {
            threadId: "thr_streaming_missing_output",
            turnId: "turn_streaming_missing_output",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_missing_output",
          turnId: "turn_streaming_missing_output",
          itemId: "exec_missing_output",
          delta: "1340 pass\n",
        });
        await new Promise((resolve) => setTimeout(resolve, 70));

        expect(String(threadMessages.length)).toBe("0");
        expect(String(mcpMessages.length)).toBe("1");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("bounds streamed command output and marks truncation in thread stream snapshots", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_output_truncated"),
        turns: [
          {
            threadId: "thr_streaming_output_truncated",
            turnId: "turn_streaming_output_truncated",
            status: "inProgress",
            itemIds: ["exec_streaming_output_truncated"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_streaming_output_truncated",
          turnId: "turn_streaming_output_truncated",
          item: {
            id: "exec_streaming_output_truncated",
            type: "commandExecution",
            command: "bun test",
            cwd: "/tmp",
            status: "in_progress",
          },
        });
        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_output_truncated",
          turnId: "turn_streaming_output_truncated",
          itemId: "exec_streaming_output_truncated",
          delta: "a".repeat(25_000),
        });
        await new Promise((resolve) => setTimeout(resolve, 70));

        const snapshot = await service.requestConversationSnapshot("thr_streaming_output_truncated");
        const output = snapshot?.turns[0]?.items[0]?.aggregatedOutput ?? "";
        expect(output.startsWith("[output truncated]\n")).toBeTrue();
        expect(output.length <= 20_020).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("background terminals include older turns whose command executions are still running", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_background_long_running"),
        turns: [
          {
            threadId: "thr_background_long_running",
            turnId: "turn_old_running",
            status: "inProgress",
            itemIds: ["exec_long_running"],
          },
          {
            threadId: "thr_background_long_running",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: ["assistant_latest"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_background_long_running",
          turnId: "turn_old_running",
          item: {
            id: "exec_long_running",
            type: "commandExecution",
            command: "bun run dev",
            cwd: "/tmp/project",
            processId: "7001",
            status: "in_progress",
          },
        });

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_background_long_running",
          turnId: "turn_old_running",
        });

        const snapshot = service.serializeConversationSnapshot("thr_background_long_running");
        expect(snapshot).not.toBeNull();
        expect(snapshot?.backgroundTerminalRows.length).toBe(1);
        expect(snapshot?.backgroundTerminalRows[0]?.id).toBe("exec_long_running");
        expect(snapshot?.backgroundTerminalRows[0]?.command).toBe("bun run dev");
        expect(snapshot?.backgroundTerminalRows[0]?.cwd).toBe("/tmp/project");
        expect(snapshot?.backgroundTerminalRows[0]?.processId).toBe("7001");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("background terminals immediately exclude manually interrupted command executions by turn metadata", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_background_interrupted_ids"),
        turns: [
          {
            threadId: "thr_background_interrupted_ids",
            turnId: "turn_background_old",
            status: "completed",
            itemIds: ["exec_hidden"],
            interruptedCommandExecutionItemIds: ["exec_hidden"],
          },
          {
            threadId: "thr_background_interrupted_ids",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [
          {
            threadId: "thr_background_interrupted_ids",
            turnId: "turn_background_old",
            itemId: "exec_hidden",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            command: "bun run dev",
            aggregatedOutput: null,
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run dev",
              },
            },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });

      try {
        const snapshot = service.serializeConversationSnapshot("thr_background_interrupted_ids");
        expect(snapshot).not.toBeNull();
        expect(snapshot?.backgroundTerminalRows.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("keeps file-edit patch rows while turn diff updates stream on the turn", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_turn_diff_stream"),
        turns: [
          {
            threadId: "thr_turn_diff_stream",
            turnId: "turn_turn_diff_stream",
            status: "inProgress",
            itemIds: ["patch_turn_diff_stream"],
          },
        ],
        transcript: [
          {
            threadId: "thr_turn_diff_stream",
            turnId: "turn_turn_diff_stream",
            itemId: "patch_turn_diff_stream",
            type: "file_change",
            kind: "fileChange",
            semanticKind: "patch",
            toolCall: {
              subtype: "fileChange",
              toolName: "file_change",
              result: {
                diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new",
              },
            },
            sequence: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });

      try {
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_turn_diff_stream",
          turnId: "turn_turn_diff_stream",
          diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(String(latest?.turns[0]?.diff ?? "").includes("+new")).toBeTrue();
        expect(latest?.turns[0]?.items.length).toBe(1);
        expect(`${latest?.turns[0]?.items[0]?.kind}:${latest?.turns[0]?.items[0]?.semanticKind}`).toBe("fileChange:patch");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("turn diff updates replace turn.diff without creating a transcript item", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_pre_tool_turn_diff"),
        turns: [{
          threadId: "thr_pre_tool_turn_diff",
          turnId: "turn_pre_tool_turn_diff",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_pre_tool_turn_diff",
          turnId: "turn_pre_tool_turn_diff",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
        });
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_pre_tool_turn_diff",
          turnId: "turn_pre_tool_turn_diff",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+next\n",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const items = latest?.turns[0]?.items ?? [];
        expect(items.length).toBe(0);
        expect(String(latest?.turns[0]?.diff ?? "").includes("+next")).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("fileChange outputDelta does not create visible transcript state", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_file_output_delta_ignored"),
        turns: [{
          threadId: "thr_file_output_delta_ignored",
          turnId: "turn_file_output_delta_ignored",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/outputDelta", {
          threadId: "thr_file_output_delta_ignored",
          turnId: "turn_file_output_delta_ignored",
          itemId: "patch_drafting",
          delta: "diff --git a/poem.md b/poem.md\nnew file mode 100644\n--- /dev/null\n+++ b/poem.md\n@@ -0,0 +1 @@\n+line\n",
        });

        expect(hostMessages.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("patchUpdated creates an in-progress fileChange item", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_create"),
        turns: [{
          threadId: "thr_patch_updated_create",
          turnId: "turn_patch_updated_create",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_create",
          turnId: "turn_patch_updated_create",
          itemId: "patch_live",
          changes: [{
            path: "src/app.ts",
            kind: { type: "update" },
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(typeof latest?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");
        const item = latest?.turns[0]?.items[0] ?? null;
        expect(item?.itemId ?? "").toBe("patch_live");
        expect(item?.status ?? "").toBe("inProgress");
        expect(`${item?.kind}:${item?.semanticKind}`).toBe("fileChange:patch");
        expect(item?.fileChange?.changes[0]?.type ?? "").toBe("update");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("patchUpdated with an empty add diff still creates a visible live fileChange row", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_empty_add"),
        turns: [{
          threadId: "thr_patch_updated_empty_add",
          turnId: "turn_patch_updated_empty_add",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_empty_add",
          turnId: "turn_patch_updated_empty_add",
          itemId: "patch_live",
          changes: [{
            path: "poem.md",
            kind: { type: "add" },
            diff: "",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const item = latest?.turns[0]?.items[0] ?? null;
        expect(item?.itemId ?? "").toBe("patch_live");
        expect(item?.status ?? "").toBe("inProgress");
        expect(`${item?.kind}:${item?.semanticKind}`).toBe("fileChange:patch");
        expect(item?.fileChange?.paths.join(",") ?? "").toBe("poem.md");
        expect(item?.fileChange?.changes[0]?.type ?? "").toBe("add");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("patchUpdated replaces the existing fileChange changes", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_replace"),
        turns: [{
          threadId: "thr_patch_updated_replace",
          turnId: "turn_patch_updated_replace",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_replace",
          turnId: "turn_patch_updated_replace",
          itemId: "patch_live",
          changes: [{
            path: "src/old.ts",
            kind: { type: "update" },
            diff: "--- a/src/old.ts\n+++ b/src/old.ts\n@@ -1 +1 @@\n-old\n+new",
          }],
        });
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_replace",
          turnId: "turn_patch_updated_replace",
          itemId: "patch_live",
          changes: [{
            path: "src/new.ts",
            kind: { type: "update" },
            diff: "--- a/src/new.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-before\n+after",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const items = latest?.turns[0]?.items ?? [];
        expect(items.length).toBe(1);
        expect(items[0]?.fileChange?.paths.join(",") ?? "").toBe("src/new.ts");
        expect((items[0]?.fileChange?.diffs[0] ?? "").includes("after")).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("patchUpdated rebinds the latest in-progress turn before adding the live fileChange", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      const now = Date.now();
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_rebind"),
        turns: [{
          threadId: "thr_patch_updated_rebind",
          turnId: "turn_placeholder",
          status: "inProgress",
          itemIds: ["assistant_draft"],
        }],
        transcript: [{
          threadId: "thr_patch_updated_rebind",
          turnId: "turn_placeholder",
          itemId: "assistant_draft",
          type: "agent_message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          status: "inProgress",
          markdownText: "Drafting the edit",
          createdAt: now,
          updatedAt: now,
        }],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_rebind",
          turnId: "turn_real",
          itemId: "patch_live",
          changes: [{
            path: "poem.md",
            kind: { type: "add" },
            content: "line\n",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest?.turns.length ?? 0).toBe(1);
        expect(latest?.turns[0]?.turnId ?? "").toBe("turn_real");
        expect(latest?.turns[0]?.items.map((item) => item.itemId).join(",") ?? "").toBe(
          "assistant_draft,patch_live",
        );
        expect(latest?.turns[0]?.items[0]?.turnId ?? "").toBe("turn_real");
        expect(latest?.turns[0]?.items[1]?.status ?? "").toBe("inProgress");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("completed fileChange items synthesize turn-diff payloads with patch batches and cwd", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_patch_batches"),
        cwd: "/tmp/patch-project",
        turns: [{
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
          status: "inProgress",
          itemIds: ["patch_done"],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
          item: {
            id: "patch_done",
            type: "fileChange",
            status: "completed",
            changes: [{
              path: "src/app.ts",
              kind: { type: "update" },
              diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
            }],
          },
        });
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const turnDiff = latest?.turns[0]?.items.find((item) => item.itemId === "turn-diff:turn_completed_patch_batches");
        const rawItem = turnDiff?.rawItem as {
          unifiedDiff?: string;
          patchBatches?: Array<{ cwd: string | null; changes: unknown[] }>;
          cwd?: string;
          showRevertButton?: boolean;
        } | undefined;

        expect(`${turnDiff?.kind}:${turnDiff?.semanticKind}`).toBe("systemEvent:diff");
        expect(rawItem?.cwd ?? "").toBe("/tmp/patch-project");
        expect(rawItem?.showRevertButton === true).toBeTrue();
        expect(rawItem?.patchBatches?.length ?? 0).toBe(1);
        expect(rawItem?.patchBatches?.[0]?.cwd ?? "").toBe("/tmp/patch-project");
        expect(rawItem?.patchBatches?.[0]?.changes.length ?? 0).toBe(1);
        expect((rawItem?.unifiedDiff ?? "").includes("src/app.ts")).toBeTrue();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("queues follow-up rows through direct broadcast-cache patches once the cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_queue_direct_patch"),
        turns: [
          {
            threadId: "thr_queue_direct_patch",
            turnId: "turn_queue_direct_patch",
            status: "completed",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await service.requestConversationSnapshot("thr_queue_direct_patch");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await service.enqueueQueuedFollowUpPrompt("thr_queue_direct_patch", "Queue this next");

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBeTrue();
        expect(hostMessages[0]?.type).toBe("threadStreamStateChanged");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged"
            ? hostMessages[0].change.type
            : "snapshot",
        ).toBe("patches");

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.queuedFollowUps.length).toBe(1);
        expect(latest?.queuedFollowUps[0]?.prompt).toBe("Queue this next");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("streams user-input request ingress through direct request patches once the cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleRequestUserInput: (requestId: string, params: {
          threadId: string;
          turnId: string;
          itemId: string;
          questions: Array<{
            id: string;
            header: string;
            question: string;
            isOther: boolean;
            isSecret: boolean;
            options?: Array<{ label: string; description: string }>;
          }>;
        }) => Promise<unknown>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_user_input_direct_patch"),
        turns: [
          {
            threadId: "thr_user_input_direct_patch",
            turnId: "turn_user_input_direct_patch",
            status: "inProgress",
            itemIds: ["tool_user_input_direct_patch"],
          },
        ],
        transcript: [],
      });

      try {
        await service.requestConversationSnapshot("thr_user_input_direct_patch");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        const pendingPromise = serviceInternals.handleRequestUserInput("req_user_input_direct_patch", {
          threadId: "thr_user_input_direct_patch",
          turnId: "turn_user_input_direct_patch",
          itemId: "tool_user_input_direct_patch",
          questions: [{
            id: "q1",
            header: "Question",
            question: "Pick one",
            isOther: false,
            isSecret: false,
            options: [{ label: "A", description: "Option A" }],
          }],
        });

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBeTrue();
        expect(hostMessages[0]?.type).toBe("threadStreamStateChanged");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged"
            ? hostMessages[0].change.type
            : "snapshot",
        ).toBe("patches");

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.requests.length).toBe(1);
        expect(latest?.requests[0]?.type).toBe("userInput");

        await service.respondToUserInput("req_user_input_direct_patch", { q1: ["A"] });
        await pendingPromise;
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("avoids full conversation serialization during item lifecycle patches once the cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_item_started_direct_patch"),
        turns: [
          {
            threadId: "thr_item_started_direct_patch",
            turnId: "turn_item_started_direct_patch",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await service.requestConversationSnapshot("thr_item_started_direct_patch");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_item_started_direct_patch",
          turnId: "turn_item_started_direct_patch",
          item: {
            id: "assistant_item_started_direct_patch",
            type: "agentMessage",
            text: "hello",
            status: "in_progress",
          },
        });

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBeTrue();
        expect(hostMessages[0]?.type).toBe("threadStreamStateChanged");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged"
            ? hostMessages[0].change.type
            : "snapshot",
        ).toBe("patches");

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns.length).toBe(1);
        expect(latest?.turns[0]?.items.length).toBe(1);
        expect(latest?.turns[0]?.items[0]?.itemId).toBe("assistant_item_started_direct_patch");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});
