import type Database from "better-sqlite3";
import type { CodexSidebarChatsThreadOrderInput } from "../../shared/codex-sidebar-thread-move";
import { getDb } from "./database";

export type CodexSidebarChatOrderErrorCode =
  | "invalid_custom_order"
  | "invalid_task_order"
  | "invalid_visible_order"
  | "thread_not_reorderable";

export class CodexSidebarChatOrderError extends Error {
  readonly code: CodexSidebarChatOrderErrorCode;

  constructor(code: CodexSidebarChatOrderErrorCode, message: string) {
    super(message);
    this.name = "CodexSidebarChatOrderError";
    this.code = code;
  }
}

export type SetCodexSidebarChatOrderInput = CodexSidebarChatsThreadOrderInput;

export interface SetCodexSidebarChatOrderResult {
  orderedThreadIds: string[];
}

interface ChatOrderRow {
  orderedThreadIdsJson: string;
}

interface CurrentThreadRow {
  threadId: string;
  projectId: string | null;
  archived: number;
  pinned: number;
}

function fail(code: CodexSidebarChatOrderErrorCode, message: string): never {
  throw new CodexSidebarChatOrderError(code, message);
}

function assertUniqueThreadIds(
  values: readonly unknown[],
  label: string,
  errorCode: "invalid_custom_order" | "invalid_task_order" | "invalid_visible_order",
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
      return fail(errorCode, `${label} contains an invalid thread id`);
    }
    if (seen.has(value)) {
      return fail(errorCode, `${label} contains duplicate thread id ${value}`);
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseCustomOrder(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("invalid_custom_order", "Chats thread order contains invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    return fail("invalid_custom_order", "Chats thread order must be an array");
  }
  return assertUniqueThreadIds(parsed, "Chats thread order", "invalid_custom_order");
}

function readCustomOrder(database: Database.Database): string[] | null {
  const row = database.prepare(`
    SELECT ordered_thread_ids_json AS orderedThreadIdsJson
    FROM codex_sidebar_chat_order
    WHERE singleton = 1
  `).get() as ChatOrderRow | undefined;
  return row ? parseCustomOrder(row.orderedThreadIdsJson) : null;
}

function listCurrentThreads(
  database: Database.Database,
  threadIds: readonly string[],
): Map<string, CurrentThreadRow> {
  if (threadIds.length === 0) return new Map();
  const placeholders = threadIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT
      t.thread_id AS threadId,
      t.project_id AS projectId,
      t.archived,
      CASE WHEN pt.thread_id IS NULL THEN 0 ELSE 1 END AS pinned
    FROM codex_threads t
    LEFT JOIN codex_pinned_threads pt ON pt.thread_id = t.thread_id
    WHERE t.thread_id IN (${placeholders})
  `).all(...threadIds) as CurrentThreadRow[];
  return new Map(rows.map((row) => [row.threadId, row]));
}

function assertCurrentUnpinnedTasks(
  database: Database.Database,
  taskThreadIds: readonly string[],
): Map<string, CurrentThreadRow> {
  const currentThreads = listCurrentThreads(database, taskThreadIds);
  for (const threadId of taskThreadIds) {
    const thread = currentThreads.get(threadId);
    if (thread && thread.archived === 0 && thread.pinned === 0) continue;
    return fail(
      "thread_not_reorderable",
      `Thread ${threadId} is not a current unpinned real task`,
    );
  }
  return currentThreads;
}

function assertProjectlessThreads(input: {
  currentThreads: ReadonlyMap<string, CurrentThreadRow>;
  threadIds: readonly string[];
}): void {
  for (const threadId of input.threadIds) {
    const thread = input.currentThreads.get(threadId);
    if (
      thread
      && thread.projectId === null
      && thread.archived === 0
      && thread.pinned === 0
    ) {
      continue;
    }
    return fail(
      "thread_not_reorderable",
      `Thread ${threadId} is not a current unpinned projectless task`,
    );
  }
}

function assertSameThreadIdSet(
  visibleThreadIds: readonly string[],
  nextVisibleThreadIds: readonly string[],
): void {
  if (visibleThreadIds.length !== nextVisibleThreadIds.length) {
    return fail(
      "invalid_visible_order",
      "The current and next visible Chats orders must have the same length",
    );
  }
  const nextThreadIds = new Set(nextVisibleThreadIds);
  for (const threadId of visibleThreadIds) {
    if (nextThreadIds.has(threadId)) continue;
    return fail(
      "invalid_visible_order",
      "The next visible Chats order must contain the same threads",
    );
  }
}

function appendNewTaskThreadIds(
  storedOrder: readonly string[],
  taskThreadIds: readonly string[],
): string[] {
  const result = [...storedOrder];
  const seen = new Set(storedOrder);
  for (const threadId of taskThreadIds) {
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    result.push(threadId);
  }
  return result;
}

function replaceVisibleThreadIdSlots(input: {
  completeThreadOrder: readonly string[];
  visibleThreadIds: readonly string[];
  nextVisibleThreadIds: readonly string[];
}): string[] {
  const visibleSet = new Set(input.visibleThreadIds);
  let nextVisibleIndex = 0;
  return input.completeThreadOrder.map((threadId) => {
    if (!visibleSet.has(threadId)) return threadId;
    const replacement = input.nextVisibleThreadIds[nextVisibleIndex];
    nextVisibleIndex += 1;
    return replacement ?? threadId;
  });
}

function writeCustomOrder(
  database: Database.Database,
  orderedThreadIds: readonly string[],
  now: string,
): void {
  database.prepare(`
    INSERT INTO codex_sidebar_chat_order (
      singleton,
      ordered_thread_ids_json,
      updated_at
    ) VALUES (1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      ordered_thread_ids_json = excluded.ordered_thread_ids_json,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(orderedThreadIds), now);
}

export function getCodexSidebarChatOrder(): string[] | null {
  const order = readCustomOrder(getDb());
  return order === null ? null : [...order];
}

export function setCodexSidebarChatOrder(
  input: SetCodexSidebarChatOrderInput,
): SetCodexSidebarChatOrderResult {
  const database = getDb();
  const setOrder = database.transaction((): SetCodexSidebarChatOrderResult => {
    const taskThreadIds = assertUniqueThreadIds(
      input.threadIdsInDisplayOrder,
      "threadIdsInDisplayOrder",
      "invalid_task_order",
    );
    const visibleThreadIds = assertUniqueThreadIds(
      input.visibleThreadIds,
      "visibleThreadIds",
      "invalid_visible_order",
    );
    const nextVisibleThreadIds = assertUniqueThreadIds(
      input.nextVisibleThreadIds,
      "nextVisibleThreadIds",
      "invalid_visible_order",
    );
    assertSameThreadIdSet(visibleThreadIds, nextVisibleThreadIds);
    const currentThreads = assertCurrentUnpinnedTasks(database, taskThreadIds);
    assertProjectlessThreads({
      currentThreads,
      threadIds: taskThreadIds,
    });

    const taskThreadIdSet = new Set(taskThreadIds);
    const completeThreadOrder = appendNewTaskThreadIds(
      (readCustomOrder(database) ?? taskThreadIds).filter((threadId) => (
        taskThreadIdSet.has(threadId)
      )),
      taskThreadIds,
    );
    const nextCustomThreadOrder = replaceVisibleThreadIdSlots({
      completeThreadOrder,
      visibleThreadIds,
      nextVisibleThreadIds,
    });
    writeCustomOrder(database, nextCustomThreadOrder, new Date().toISOString());
    return { orderedThreadIds: [...nextCustomThreadOrder] };
  });

  return setOrder.immediate();
}
