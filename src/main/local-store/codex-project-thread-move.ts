import type Database from "better-sqlite3";
import { parseProjectSessionTabConfig } from "../../shared/schemas/project-sessions";
import { getDb } from "./database";
import { stringifyProjectSessionTabConfig } from "./project-sessions";

export type CodexProjectThreadMoveErrorCode =
  | "invalid_custom_order"
  | "invalid_placement"
  | "stale_source"
  | "target_project_not_found"
  | "thread_not_found"
  | "thread_session_not_found";

export class CodexProjectThreadMoveError extends Error {
  readonly code: CodexProjectThreadMoveErrorCode;

  constructor(code: CodexProjectThreadMoveErrorCode, message: string) {
    super(message);
    this.name = "CodexProjectThreadMoveError";
    this.code = code;
  }
}

export interface MoveCodexProjectThreadInput {
  threadId: string;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  beforeThreadId?: string | null;
  insertAtEnd?: boolean;
  useDefaultOrder?: boolean;
  threadMetadataPatch?: CodexProjectThreadMetadataPatch;
}

export interface CodexProjectThreadMetadataPatch {
  cwd?: string | null;
  managedWorktreePath?: string | null;
  projectlessOutputDirectory?: string | null;
  projectlessWorkspaceBrowserRoot?: string | null;
}

export interface MoveCodexProjectThreadResult {
  threadId: string;
  sessionId: string;
  sourceProjectId: string | null;
  targetProjectId: string | null;
}

interface ThreadSessionOwnerRow {
  threadProjectId: string | null;
  sessionId: string | null;
  sessionPinned: number | null;
  sessionProjectId: string | null;
}

interface ProjectThreadRow {
  threadId: string;
  threadProjectId: string | null;
}

interface CustomOrderRow {
  projectId: string;
  orderedThreadIdsJson: string;
}

interface BrowserTabConfigRow {
  id: string;
  configJson: string;
}

type Placement =
  | { type: "before"; beforeThreadId: string }
  | { type: "end" }
  | { type: "start" }
  | { type: "default" };

function fail(code: CodexProjectThreadMoveErrorCode, message: string): never {
  throw new CodexProjectThreadMoveError(code, message);
}

function requireId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized) return normalized;
  return fail("invalid_placement", `${label} must be a non-empty string`);
}

function normalizeProjectScopeId(value: string | null, label: string): string | null {
  if (value === null) return null;
  return requireId(value, label);
}

function resolvePlacement(input: MoveCodexProjectThreadInput): Placement {
  const beforeThreadId = input.beforeThreadId?.trim() || null;
  const insertAtEnd = input.insertAtEnd === true;
  const useDefaultOrder = input.useDefaultOrder === true;
  if (useDefaultOrder && (beforeThreadId !== null || insertAtEnd)) {
    return fail(
      "invalid_placement",
      "useDefaultOrder cannot be combined with beforeThreadId or insertAtEnd",
    );
  }
  if (beforeThreadId !== null && insertAtEnd) {
    return fail("invalid_placement", "beforeThreadId cannot be combined with insertAtEnd");
  }
  if (useDefaultOrder) return { type: "default" };
  if (beforeThreadId !== null) return { type: "before", beforeThreadId };
  if (insertAtEnd) return { type: "end" };
  return { type: "start" };
}

function parseCustomOrder(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const orderedThreadIds: string[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
      return null;
    }
    if (seen.has(value)) return null;
    seen.add(value);
    orderedThreadIds.push(value);
  }
  return orderedThreadIds;
}

function stringifyCustomOrder(orderedThreadIds: readonly string[]): string {
  return JSON.stringify(orderedThreadIds);
}

function threadOrdersEqual(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((threadId, index) => threadId === right[index]);
}

function assertUniqueThreadIds(orderedThreadIds: readonly string[]): string[] {
  const validated: string[] = [];
  const seen = new Set<string>();
  for (const value of orderedThreadIds) {
    const threadId = requireId(value, "threadId");
    if (seen.has(threadId)) {
      return fail("invalid_custom_order", `Thread order contains duplicate id ${threadId}`);
    }
    seen.add(threadId);
    validated.push(threadId);
  }
  return validated;
}

function projectExists(database: Database.Database, projectId: string): boolean {
  return database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId) !== undefined;
}

function resolveThreadOwner(
  database: Database.Database,
  threadId: string,
): ThreadSessionOwnerRow {
  const owner = database.prepare(`
    SELECT
      t.project_id AS threadProjectId,
      pst.session_id AS sessionId,
      ps.pinned AS sessionPinned,
      ps.project_id AS sessionProjectId
    FROM codex_threads t
    LEFT JOIN project_session_threads pst ON pst.thread_id = t.thread_id
    LEFT JOIN project_sessions ps ON ps.id = pst.session_id
    WHERE t.thread_id = ?
  `).get(threadId) as ThreadSessionOwnerRow | undefined;
  if (!owner) {
    return fail("thread_not_found", `Thread ${threadId} does not exist`);
  }
  if (owner.sessionId === null) {
    return fail("thread_session_not_found", `Thread ${threadId} has no project session`);
  }
  return owner;
}

function listProjectThreads(
  database: Database.Database,
  projectId: string,
): ProjectThreadRow[] {
  return database.prepare(`
    SELECT
      t.thread_id AS threadId,
      t.project_id AS threadProjectId
    FROM project_sessions ps
    JOIN project_session_threads pst ON pst.session_id = ps.id
    JOIN codex_threads t ON t.thread_id = pst.thread_id
    WHERE ps.project_id = ?
    ORDER BY
      t.updated_at DESC,
      t.created_at DESC,
      t.thread_id ASC
  `).all(projectId) as ProjectThreadRow[];
}

function listProjectThreadIds(
  database: Database.Database,
  projectId: string,
): string[] {
  return listProjectThreads(database, projectId).map((thread) => {
    if (thread.threadProjectId === projectId) return thread.threadId;
    return fail("stale_source", `Project ${projectId} has inconsistent thread ownership`);
  });
}

function listCustomOrders(database: Database.Database): Map<string, string[]> {
  const rows = database.prepare(`
    SELECT
      project_id AS projectId,
      ordered_thread_ids_json AS orderedThreadIdsJson
    FROM codex_project_thread_orders
    ORDER BY project_id ASC
  `).all() as CustomOrderRow[];
  return new Map(rows.flatMap((row) => {
    const orderedThreadIds = parseCustomOrder(row.orderedThreadIdsJson);
    return orderedThreadIds === null ? [] : [[row.projectId, orderedThreadIds] as const];
  }));
}

export function listCodexProjectThreadOrders(): Record<string, string[]> {
  return Object.fromEntries(listCustomOrders(getDb()));
}

function writeCustomOrder(
  database: Database.Database,
  projectId: string,
  orderedThreadIds: readonly string[],
  now: string,
): void {
  database.prepare(`
    INSERT INTO codex_project_thread_orders (
      project_id,
      ordered_thread_ids_json,
      updated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      ordered_thread_ids_json = excluded.ordered_thread_ids_json,
      updated_at = excluded.updated_at
  `).run(projectId, stringifyCustomOrder(orderedThreadIds), now);
}

function updateThreadOwnershipAndMetadata(input: {
  database: Database.Database;
  threadId: string;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  patch: CodexProjectThreadMetadataPatch | undefined;
}): void {
  const fields = ["project_id = ?"];
  const values: Array<string | null> = [input.targetProjectId];
  const appendOptionalField = (
    inputKey: keyof CodexProjectThreadMetadataPatch,
    columnName: string,
  ) => {
    if (!input.patch || !Object.prototype.hasOwnProperty.call(input.patch, inputKey)) return;
    fields.push(`${columnName} = ?`);
    values.push(input.patch[inputKey] ?? null);
  };
  appendOptionalField("cwd", "cwd");
  appendOptionalField("managedWorktreePath", "managed_worktree_path");
  appendOptionalField("projectlessOutputDirectory", "projectless_output_directory");
  appendOptionalField(
    "projectlessWorkspaceBrowserRoot",
    "projectless_workspace_browser_root",
  );
  values.push(input.threadId, input.sourceProjectId);

  const updated = input.database.prepare(`
    UPDATE codex_threads
    SET ${fields.join(", ")}
    WHERE thread_id = ? AND project_id IS ?
  `).run(...values);
  if (updated.changes === 1) return;
  return fail("stale_source", `Thread ${input.threadId} changed project during thread move`);
}

function appendUntrackedThreadIds(
  trackedThreadIds: readonly string[],
  currentThreadIds: readonly string[],
): string[] {
  const result = [...trackedThreadIds];
  const seen = new Set(trackedThreadIds);
  for (const threadId of currentThreadIds) {
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    result.push(threadId);
  }
  return result;
}

function projectRequestedThreadOrder(input: {
  completeThreadOrder: readonly string[];
  requestedThreadIds: readonly string[];
}): string[] {
  const requestedThreadIdSet = new Set(input.requestedThreadIds);
  let requestedIndex = 0;
  return input.completeThreadOrder.map((threadId) => {
    if (!requestedThreadIdSet.has(threadId)) return threadId;
    const replacement = input.requestedThreadIds[requestedIndex];
    requestedIndex += 1;
    return replacement ?? threadId;
  });
}

function reconcileTargetCustomOrder(input: {
  existingTargetOrder: readonly string[];
  knownTargetThreadIds: readonly string[];
  movedThreadId: string;
  placement: Placement;
}): string[] {
  const reconciled = [...input.existingTargetOrder];
  const reconciledSet = new Set(reconciled);
  for (const threadId of input.knownTargetThreadIds) {
    if (reconciledSet.has(threadId)) continue;
    reconciledSet.add(threadId);
    reconciled.push(threadId);
  }

  if (input.placement.type === "end") return [...reconciled, input.movedThreadId];
  if (input.placement.type === "start") return [input.movedThreadId, ...reconciled];
  if (input.placement.type === "default") return reconciled;

  const anchorIndex = reconciled.indexOf(input.placement.beforeThreadId);
  if (anchorIndex < 0) return [...reconciled, input.movedThreadId];
  return [
    ...reconciled.slice(0, anchorIndex),
    input.movedThreadId,
    ...reconciled.slice(anchorIndex),
  ];
}

export function getCodexProjectThreadOrder(projectId: string): string[] | null {
  projectId = requireId(projectId, "projectId");
  const row = getDb().prepare(`
    SELECT ordered_thread_ids_json AS orderedThreadIdsJson
    FROM codex_project_thread_orders
    WHERE project_id = ?
  `).get(projectId) as Pick<CustomOrderRow, "orderedThreadIdsJson"> | undefined;
  return row ? parseCustomOrder(row.orderedThreadIdsJson) : null;
}

/** Persist project-lane manual order without mutating project-session layout. */
export function setCodexProjectThreadOrder(
  projectId: string,
  orderedThreadIds: readonly string[] | null,
): void {
  projectId = requireId(projectId, "projectId");
  const database = getDb();
  const setOrder = database.transaction(() => {
    if (!projectExists(database, projectId)) {
      return fail("target_project_not_found", `Project ${projectId} does not exist`);
    }

    if (orderedThreadIds === null) {
      database.prepare("DELETE FROM codex_project_thread_orders WHERE project_id = ?").run(projectId);
      return;
    }

    const requestedThreadOrder = assertUniqueThreadIds(orderedThreadIds);
    const currentThreadIds = listProjectThreadIds(database, projectId);
    const currentThreadIdSet = new Set(currentThreadIds);
    for (const threadId of requestedThreadOrder) {
      if (currentThreadIdSet.has(threadId)) continue;
      return fail("invalid_custom_order", `Thread ${threadId} is not in project ${projectId}`);
    }

    const trackedThreadIds = appendUntrackedThreadIds(
      listCustomOrders(database).get(projectId) ?? currentThreadIds,
      currentThreadIds,
    );
    const customThreadOrder = projectRequestedThreadOrder({
      completeThreadOrder: trackedThreadIds,
      requestedThreadIds: requestedThreadOrder,
    });
    const now = new Date().toISOString();
    writeCustomOrder(database, projectId, customThreadOrder, now);
  });

  setOrder.immediate();
}

function moveCodexProjectThreadMembership(
  database: Database.Database,
  input: {
    threadId: string;
    sourceProjectId: string | null;
    targetProjectId: string | null;
    threadMetadataPatch?: CodexProjectThreadMetadataPatch;
  },
): MoveCodexProjectThreadResult {
  const { threadId, sourceProjectId, targetProjectId } = input;
  if (targetProjectId !== null && !projectExists(database, targetProjectId)) {
    return fail("target_project_not_found", `Project ${targetProjectId} does not exist`);
  }

  const owner = resolveThreadOwner(database, threadId);
  if (owner.threadProjectId !== sourceProjectId || owner.sessionProjectId !== sourceProjectId) {
    return fail("stale_source", `Thread ${threadId} is no longer in project ${sourceProjectId}`);
  }
  const sessionId = owner.sessionId;
  if (!sessionId) {
    return fail("thread_session_not_found", `Thread ${threadId} has no project session`);
  }
  if (sourceProjectId === targetProjectId) {
    return { threadId, sessionId, sourceProjectId, targetProjectId };
  }

  const now = new Date().toISOString();
  // Session order belongs to the shell. A cross-Project ownership move gets
  // one deterministic shell placement; sidebar before/end intent is applied
  // separately to durable thread IDs below.
  const nextPinnedOrder = owner.sessionPinned === 1
    ? ((database.prepare(`
        SELECT MAX(pinned_order) AS maxPinnedOrder
        FROM project_sessions
        WHERE project_id IS ? AND pinned = 1 AND archived = 0
      `).get(targetProjectId) as { maxPinnedOrder: number | null } | undefined)
        ?.maxPinnedOrder ?? -1) + 1
    : null;
  database.prepare(`
    UPDATE project_sessions
    SET "order" = "order" + 1, updated_at = ?
    WHERE project_id IS ?
  `).run(now, targetProjectId);
  const moved = database.prepare(`
    UPDATE project_sessions
    SET
      project_id = ?,
      "order" = 0,
      pinned_order = ?,
      updated_at = ?
    WHERE id = ? AND project_id IS ?
  `).run(targetProjectId, nextPinnedOrder, now, sessionId, sourceProjectId);
  if (moved.changes !== 1) {
    return fail("stale_source", `Session ${sessionId} changed project during thread move`);
  }
  if (targetProjectId !== null) {
    database.prepare(`
      UPDATE project_session_tabs
      SET project_id = ?, updated_at = ?
      WHERE session_id = ?
    `).run(targetProjectId, now, sessionId);
    const browserTabs = database.prepare(`
      SELECT id, config_json AS configJson
      FROM project_session_tabs
      WHERE session_id = ? AND kind = 'browser'
      ORDER BY id
    `).all(sessionId) as BrowserTabConfigRow[];
    const updateBrowserTabConfig = database.prepare(`
      UPDATE project_session_tabs
      SET config_json = ?, updated_at = ?
      WHERE id = ? AND session_id = ?
    `);
    for (const browserTab of browserTabs) {
      const config = parseProjectSessionTabConfig(
        "browser",
        JSON.parse(browserTab.configJson),
      );
      updateBrowserTabConfig.run(
        stringifyProjectSessionTabConfig(targetProjectId, {
          ...config,
          projectId: targetProjectId,
        }),
        now,
        browserTab.id,
        sessionId,
      );
    }
  }
  updateThreadOwnershipAndMetadata({
    database,
    threadId,
    sourceProjectId,
    targetProjectId,
    patch: input.threadMetadataPatch,
  });
  return { threadId, sessionId, sourceProjectId, targetProjectId };
}

function saveCodexProjectThreadMoveSidebarState(
  database: Database.Database,
  receipt: MoveCodexProjectThreadResult,
  placement: Placement,
): void {
  const owner = resolveThreadOwner(database, receipt.threadId);
  if (
    owner.sessionId !== receipt.sessionId
    || owner.threadProjectId !== receipt.targetProjectId
    || owner.sessionProjectId !== receipt.targetProjectId
  ) {
    return fail("stale_source", `Thread ${receipt.threadId} changed during move`);
  }

  const currentCustomOrders = listCustomOrders(database);
  const changedCustomOrders = new Map<string, string[]>();
  for (const [projectId, orderedThreadIds] of currentCustomOrders) {
    const filteredOrder = orderedThreadIds.filter((threadId) => (
      threadId !== receipt.threadId
    ));
    if (filteredOrder.length === orderedThreadIds.length) continue;
    changedCustomOrders.set(projectId, filteredOrder);
  }
  if (placement.type !== "default" && receipt.targetProjectId !== null) {
    const knownTargetThreadIds = listProjectThreadIds(
      database,
      receipt.targetProjectId,
    ).filter((threadId) => threadId !== receipt.threadId);
    const targetCustomThreadOrder = reconcileTargetCustomOrder({
      existingTargetOrder: changedCustomOrders.get(receipt.targetProjectId)
        ?? currentCustomOrders.get(receipt.targetProjectId)
        ?? [],
      knownTargetThreadIds,
      movedThreadId: receipt.threadId,
      placement,
    });
    changedCustomOrders.set(receipt.targetProjectId, targetCustomThreadOrder);
  }

  const now = new Date().toISOString();
  for (const [projectId, orderedThreadIds] of changedCustomOrders) {
    if (threadOrdersEqual(currentCustomOrders.get(projectId), orderedThreadIds)) continue;
    writeCustomOrder(database, projectId, orderedThreadIds, now);
  }
}

export function moveCodexProjectThread(
  input: MoveCodexProjectThreadInput,
): MoveCodexProjectThreadResult {
  const threadId = requireId(input.threadId, "threadId");
  const sourceProjectId = normalizeProjectScopeId(input.sourceProjectId, "sourceProjectId");
  const targetProjectId = normalizeProjectScopeId(input.targetProjectId, "targetProjectId");
  const placement = resolvePlacement(input);
  const database = getDb();
  const move = database.transaction(() => {
    const receipt = moveCodexProjectThreadMembership(database, {
      threadId,
      sourceProjectId,
      targetProjectId,
      threadMetadataPatch: input.threadMetadataPatch,
    });
    saveCodexProjectThreadMoveSidebarState(database, receipt, placement);
    return receipt;
  });
  return move.immediate();
}
