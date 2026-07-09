import type Database from "better-sqlite3";
import { getDb } from "./database";

export type CodexProjectThreadMoveErrorCode =
  | "ambiguous_thread_session"
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
  sourceSessionIdsInOrder: string[];
  targetSessionIdsInOrder: string[];
  targetCustomThreadOrder: string[] | null;
  sidebarOrderError: Error | null;
}

export interface SetCodexProjectThreadOrderResult {
  projectId: string;
  customThreadOrder: string[] | null;
  sessionIdsInOrder: string[];
}

interface ThreadSessionOwnerRow {
  threadId: string;
  threadProjectId: string | null;
  sessionId: string | null;
  sessionProjectId: string | null;
}

interface OrderedSessionRow {
  id: string;
  pinned: number;
  order: number;
  createdAt: string;
  threadId: string | null;
  threadProjectId: string | null;
  threadUpdatedAt: number | null;
}

interface CustomOrderRow {
  projectId: string;
  orderedThreadIdsJson: string;
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

function listThreadOwners(database: Database.Database, threadId: string): ThreadSessionOwnerRow[] {
  return database.prepare(`
    SELECT
      t.thread_id AS threadId,
      t.project_id AS threadProjectId,
      pst.session_id AS sessionId,
      ps.project_id AS sessionProjectId
    FROM codex_threads t
    LEFT JOIN project_session_threads pst ON pst.thread_id = t.thread_id
    LEFT JOIN project_sessions ps ON ps.id = pst.session_id
    WHERE t.thread_id = ?
    ORDER BY pst.linked_at ASC, pst.session_id ASC
  `).all(threadId) as ThreadSessionOwnerRow[];
}

function resolveThreadOwner(
  database: Database.Database,
  threadId: string,
): ThreadSessionOwnerRow {
  const owners = listThreadOwners(database, threadId);
  if (owners.length === 0) {
    return fail("thread_not_found", `Thread ${threadId} does not exist`);
  }
  const linkedOwners = owners.filter((owner) => owner.sessionId !== null);
  if (linkedOwners.length === 0) {
    return fail("thread_session_not_found", `Thread ${threadId} has no project session`);
  }
  if (linkedOwners.length > 1) {
    return fail("ambiguous_thread_session", `Thread ${threadId} belongs to more than one project session`);
  }
  const owner = linkedOwners[0];
  if (!owner) {
    return fail("thread_session_not_found", `Thread ${threadId} has no project session`);
  }
  return owner;
}

function listOrderedSessions(
  database: Database.Database,
  projectId: string | null,
): OrderedSessionRow[] {
  return database.prepare(`
    SELECT
      ps.id,
      ps.pinned,
      ps."order" AS "order",
      ps.created_at AS createdAt,
      pst.thread_id AS threadId,
      t.project_id AS threadProjectId,
      t.updated_at AS threadUpdatedAt
    FROM project_sessions ps
    LEFT JOIN project_session_threads pst ON pst.session_id = ps.id
    LEFT JOIN codex_threads t ON t.thread_id = pst.thread_id
    WHERE ps.project_id IS ?
    ORDER BY ps."order" ASC, ps.created_at ASC, ps.id ASC
  `).all(projectId) as OrderedSessionRow[];
}

function listThreadIdsInSessionOrder(sessions: readonly OrderedSessionRow[]): string[] {
  return sessions.flatMap((session) => session.threadId ? [session.threadId] : []);
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

function writeSessionOrder(
  database: Database.Database,
  projectId: string | null,
  orderedSessions: readonly OrderedSessionRow[],
  now: string,
): void {
  const update = database.prepare(`
    UPDATE project_sessions
    SET "order" = ?, pinned_order = ?, updated_at = ?
    WHERE id = ? AND project_id IS ?
  `);
  let pinnedOrder = 0;
  for (const [order, session] of orderedSessions.entries()) {
    const nextPinnedOrder = session.pinned === 1 ? pinnedOrder++ : null;
    const result = update.run(order, nextPinnedOrder, now, session.id, projectId);
    if (result.changes === 1) continue;
    return fail("stale_source", `Session ${session.id} changed project during thread move`);
  }
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

function insertSessionAtPlacement(input: {
  targetSessions: readonly OrderedSessionRow[];
  movedSession: OrderedSessionRow;
  placement: Placement;
  anchorSessionId: string | null;
}): OrderedSessionRow[] {
  if (input.placement.type === "end") {
    return [...input.targetSessions, input.movedSession];
  }
  if (input.placement.type === "before") {
    const targetIndex = input.targetSessions.findIndex(
      (session) => session.id === input.anchorSessionId,
    );
    if (targetIndex < 0) return [...input.targetSessions, input.movedSession];
    return [
      ...input.targetSessions.slice(0, targetIndex),
      input.movedSession,
      ...input.targetSessions.slice(targetIndex),
    ];
  }
  return [input.movedSession, ...input.targetSessions];
}

function compareDefaultThreadSessions(
  left: OrderedSessionRow,
  right: OrderedSessionRow,
): number {
  const updatedAtDelta = (right.threadUpdatedAt ?? 0) - (left.threadUpdatedAt ?? 0);
  if (updatedAtDelta !== 0) return updatedAtDelta;
  if (left.order !== right.order) return left.order - right.order;
  const createdAtDelta = right.createdAt.localeCompare(left.createdAt);
  if (createdAtDelta !== 0) return createdAtDelta;
  return left.id.localeCompare(right.id);
}

function projectDefaultThreadOrder(
  completeSessions: readonly OrderedSessionRow[],
): OrderedSessionRow[] {
  const orderedThreadSessions = completeSessions
    .filter((session) => session.threadId !== null)
    .sort(compareDefaultThreadSessions);
  let nextThreadIndex = 0;
  return completeSessions.map((session) => {
    if (session.threadId === null) return session;
    const replacement = orderedThreadSessions[nextThreadIndex];
    nextThreadIndex += 1;
    return replacement ?? session;
  });
}

function projectCustomThreadOrder(input: {
  completeSessions: readonly OrderedSessionRow[];
  projectId: string;
  orderedThreadIds: readonly string[];
}): OrderedSessionRow[] {
  const threadSessions = input.completeSessions.filter((session) => session.threadId !== null);
  const sessionByThreadId = new Map<string, OrderedSessionRow>();
  for (const session of threadSessions) {
    const threadId = session.threadId;
    if (!threadId || session.threadProjectId !== input.projectId) {
      return fail("stale_source", `Project ${input.projectId} has inconsistent thread ownership`);
    }
    if (sessionByThreadId.has(threadId)) {
      return fail("ambiguous_thread_session", `Thread ${threadId} has more than one project session`);
    }
    sessionByThreadId.set(threadId, session);
  }
  const orderedThreadSessions = input.orderedThreadIds.map((threadId) => {
    const session = sessionByThreadId.get(threadId);
    if (session) return session;
    return fail("invalid_custom_order", `Thread ${threadId} is not in project ${input.projectId}`);
  });
  const selectedThreadIds = new Set(input.orderedThreadIds);
  let nextThreadIndex = 0;
  return input.completeSessions.map((session) => {
    if (session.threadId === null || !selectedThreadIds.has(session.threadId)) return session;
    const replacement = orderedThreadSessions[nextThreadIndex];
    nextThreadIndex += 1;
    return replacement ?? session;
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

export function setCodexProjectThreadOrder(
  projectId: string,
  orderedThreadIds: readonly string[] | null,
): SetCodexProjectThreadOrderResult {
  projectId = requireId(projectId, "projectId");
  const database = getDb();
  const setOrder = database.transaction((): SetCodexProjectThreadOrderResult => {
    if (!projectExists(database, projectId)) {
      return fail("target_project_not_found", `Project ${projectId} does not exist`);
    }

    const completeSessions = listOrderedSessions(database, projectId);
    const requestedThreadOrder = orderedThreadIds === null
      ? null
      : assertUniqueThreadIds(orderedThreadIds);
    const orderedSessions = requestedThreadOrder === null
      ? projectDefaultThreadOrder(completeSessions)
      : projectCustomThreadOrder({
        completeSessions,
        projectId,
        orderedThreadIds: requestedThreadOrder,
      });
    const customThreadOrder = requestedThreadOrder === null
      ? null
      : listThreadIdsInSessionOrder(orderedSessions);
    const now = new Date().toISOString();
    writeSessionOrder(database, projectId, orderedSessions, now);
    if (customThreadOrder === null) {
      database.prepare("DELETE FROM codex_project_thread_orders WHERE project_id = ?").run(projectId);
    } else {
      writeCustomOrder(database, projectId, customThreadOrder, now);
    }
    return {
      projectId,
      customThreadOrder: customThreadOrder === null ? null : [...customThreadOrder],
      sessionIdsInOrder: orderedSessions.map((session) => session.id),
    };
  });

  return setOrder.immediate();
}

export interface CodexProjectThreadMembershipReceipt {
  threadId: string;
  sessionId: string;
  sourceProjectId: string | null;
  targetProjectId: string | null;
}

export interface SaveCodexProjectThreadMoveSidebarStateInput {
  receipt: CodexProjectThreadMembershipReceipt;
  beforeThreadId?: string | null;
  insertAtEnd?: boolean;
  useDefaultOrder?: boolean;
}

export interface SaveCodexProjectThreadMoveSidebarStateResult {
  sourceSessionIdsInOrder: string[];
  targetSessionIdsInOrder: string[];
  targetCustomThreadOrder: string[] | null;
}

export function moveCodexProjectThreadMembership(
  input: Pick<
    MoveCodexProjectThreadInput,
    "threadId" | "sourceProjectId" | "targetProjectId" | "threadMetadataPatch"
  >,
): CodexProjectThreadMembershipReceipt {
  const threadId = requireId(input.threadId, "threadId");
  const sourceProjectId = normalizeProjectScopeId(input.sourceProjectId, "sourceProjectId");
  const targetProjectId = normalizeProjectScopeId(input.targetProjectId, "targetProjectId");
  const database = getDb();
  const moveMembership = database.transaction((): CodexProjectThreadMembershipReceipt => {
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
    const moved = database.prepare(`
      UPDATE project_sessions
      SET project_id = ?, updated_at = ?
      WHERE id = ? AND project_id IS ?
    `).run(targetProjectId, now, sessionId, sourceProjectId);
    if (moved.changes !== 1) {
      return fail("stale_source", `Session ${sessionId} changed project during thread move`);
    }
    if (targetProjectId !== null) {
      database.prepare(`
        UPDATE project_session_tabs
        SET project_id = ?, updated_at = ?
        WHERE session_id = ?
      `).run(targetProjectId, now, sessionId);
    }
    updateThreadOwnershipAndMetadata({
      database,
      threadId,
      sourceProjectId,
      targetProjectId,
      patch: input.threadMetadataPatch,
    });
    database.prepare(`
      UPDATE thread_search_units
      SET project_id = ?
      WHERE thread_id = ?
    `).run(targetProjectId, threadId);
    return { threadId, sessionId, sourceProjectId, targetProjectId };
  });

  return moveMembership.immediate();
}

export function saveCodexProjectThreadMoveSidebarState(
  input: SaveCodexProjectThreadMoveSidebarStateInput,
): SaveCodexProjectThreadMoveSidebarStateResult {
  const { receipt } = input;
  const placement = resolvePlacement({
    threadId: receipt.threadId,
    sourceProjectId: receipt.sourceProjectId,
    targetProjectId: receipt.targetProjectId,
    beforeThreadId: input.beforeThreadId,
    insertAtEnd: input.insertAtEnd,
    useDefaultOrder: input.useDefaultOrder,
  });
  const sameScope = receipt.sourceProjectId === receipt.targetProjectId;
  const database = getDb();
  const saveSidebarState = database.transaction((): SaveCodexProjectThreadMoveSidebarStateResult => {
    const owner = resolveThreadOwner(database, receipt.threadId);
    if (
      owner.sessionId !== receipt.sessionId
      || owner.threadProjectId !== receipt.targetProjectId
      || owner.sessionProjectId !== receipt.targetProjectId
    ) {
      return fail("stale_source", `Thread ${receipt.threadId} changed after membership save`);
    }

    const sourceSessions = listOrderedSessions(database, receipt.sourceProjectId);
    const targetSessions = sameScope
      ? sourceSessions
      : listOrderedSessions(database, receipt.targetProjectId);
    const movedSession = targetSessions.find((session) => session.id === receipt.sessionId);
    if (!movedSession) {
      return fail("thread_session_not_found", `Moved session ${receipt.sessionId} is missing`);
    }
    const targetSessionsWithoutMoved = targetSessions.filter((session) => (
      session.id !== receipt.sessionId
    ));
    const anchorSessionId = placement.type === "before"
      ? targetSessionsWithoutMoved.find((session) => (
          session.threadId === placement.beforeThreadId
        ))?.id ?? null
      : null;
    const defaultOrderSessions = sameScope
      ? targetSessions
      : [...targetSessionsWithoutMoved, movedSession];
    let nextTargetSessions = placement.type === "default"
      ? projectDefaultThreadOrder(defaultOrderSessions)
      : insertSessionAtPlacement({
        targetSessions: targetSessionsWithoutMoved,
        movedSession,
        placement,
        anchorSessionId,
      });

    const nextCustomOrders = new Map<string, string[]>();
    for (const [projectId, orderedThreadIds] of listCustomOrders(database)) {
      nextCustomOrders.set(
        projectId,
        orderedThreadIds.filter((orderedThreadId) => orderedThreadId !== receipt.threadId),
      );
    }
    const knownTargetThreadIds = listThreadIdsInSessionOrder(targetSessionsWithoutMoved);
    let targetCustomThreadOrder: string[] | null = null;
    if (placement.type !== "default" && receipt.targetProjectId !== null) {
      targetCustomThreadOrder = reconcileTargetCustomOrder({
        existingTargetOrder: nextCustomOrders.get(receipt.targetProjectId) ?? [],
        knownTargetThreadIds,
        movedThreadId: receipt.threadId,
        placement,
      });
      nextCustomOrders.set(receipt.targetProjectId, targetCustomThreadOrder);
    } else if (
      receipt.targetProjectId !== null
      && nextCustomOrders.has(receipt.targetProjectId)
    ) {
      targetCustomThreadOrder = nextCustomOrders.get(receipt.targetProjectId) ?? [];
    }
    if (receipt.targetProjectId !== null && targetCustomThreadOrder !== null) {
      const currentTargetThreadIds = new Set(listThreadIdsInSessionOrder(nextTargetSessions));
      nextTargetSessions = projectCustomThreadOrder({
        completeSessions: nextTargetSessions,
        projectId: receipt.targetProjectId,
        orderedThreadIds: targetCustomThreadOrder.filter((targetThreadId) => (
          currentTargetThreadIds.has(targetThreadId)
        )),
      });
    }

    const nextSourceSessions = sameScope ? nextTargetSessions : sourceSessions;
    const now = new Date().toISOString();
    writeSessionOrder(database, receipt.sourceProjectId, nextSourceSessions, now);
    if (!sameScope) {
      writeSessionOrder(database, receipt.targetProjectId, nextTargetSessions, now);
    }
    database.prepare("DELETE FROM codex_project_thread_orders").run();
    for (const [projectId, orderedThreadIds] of nextCustomOrders) {
      writeCustomOrder(database, projectId, orderedThreadIds, now);
    }
    return {
      sourceSessionIdsInOrder: nextSourceSessions.map((session) => session.id),
      targetSessionIdsInOrder: nextTargetSessions.map((session) => session.id),
      targetCustomThreadOrder,
    };
  });

  return saveSidebarState.immediate();
}

export function moveCodexProjectThread(
  input: MoveCodexProjectThreadInput,
): MoveCodexProjectThreadResult {
  resolvePlacement(input);
  const receipt = moveCodexProjectThreadMembership(input);
  try {
    const sidebarState = saveCodexProjectThreadMoveSidebarState({
      receipt,
      beforeThreadId: input.beforeThreadId,
      insertAtEnd: input.insertAtEnd,
      useDefaultOrder: input.useDefaultOrder,
    });
    return {
      ...receipt,
      ...sidebarState,
      sidebarOrderError: null,
    };
  } catch (error) {
    const database = getDb();
    return {
      ...receipt,
      sourceSessionIdsInOrder: listOrderedSessions(database, receipt.sourceProjectId)
        .map((session) => session.id),
      targetSessionIdsInOrder: listOrderedSessions(database, receipt.targetProjectId)
        .map((session) => session.id),
      targetCustomThreadOrder: null,
      sidebarOrderError: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
