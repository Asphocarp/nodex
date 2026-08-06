import {
  canonicalizePortableRichText,
  plainTextToPortableRichText,
  portableRichTextPlainText,
} from "../../shared/block-documents/portable-rich-text";
import { summarizePageDescription } from "../../shared/page-summary";
import {
  DEFAULT_WORKFLOW_STATUS,
  isWorkflowStatus,
  WORKFLOW_STATUS_COLUMNS,
  type WorkflowStatus,
} from "../../shared/workflow-status";
import type {
  BlockContentSnapshot,
  BlockRecord,
  BlockRecordWindow,
  BlockViewPosition,
} from "../../shared/block-records";
import type { BoardSummary, DatabasePageSummary } from "./types";

const readString = (
  properties: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

const readDate = (
  properties: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): Date | undefined => {
  const value = readString(properties, ...keys);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const readStringList = (
  properties: Readonly<Record<string, unknown>>,
  key: string,
): string[] => {
  const value = properties[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const readObject = (
  properties: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined => {
  const value = properties[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
};

const readObjectList = (
  properties: Readonly<Record<string, unknown>>,
  key: string,
): readonly Readonly<Record<string, unknown>>[] | undefined => {
  const value = properties[key];
  if (!Array.isArray(value)) return undefined;
  const objects = value.filter(
    (item): item is Readonly<Record<string, unknown>> => (
      typeof item === "object" && item !== null && !Array.isArray(item)
    ),
  );
  return objects.length === value.length ? objects : undefined;
};

const readRichTitle = (
  properties: Readonly<Record<string, unknown>>,
  fallbackTitle: string,
): { title: string; richTitle: DatabasePageSummary["richTitle"] } => {
  const candidate = properties.richTitle;
  if (Array.isArray(candidate)) {
    try {
      const richTitle = canonicalizePortableRichText(candidate);
      return { title: portableRichTextPlainText(richTitle), richTitle };
    } catch {
      // Corrupt optional metadata must not make the entire Board unreadable.
    }
  }
  return {
    title: fallbackTitle,
    richTitle: plainTextToPortableRichText(fallbackTitle),
  };
};

const titleTextFromLegacyContent = (value: unknown): string => {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item !== "object" || item === null) return "";
    const candidate = item as { readonly text?: unknown; readonly content?: unknown };
    if (typeof candidate.text === "string") return candidate.text;
    return titleTextFromLegacyContent(candidate.content);
  }).join("");
};

const readContentTitle = (
  snapshot: BlockContentSnapshot | undefined,
): { title: string; richTitle: DatabasePageSummary["richTitle"] } | undefined => {
  if (!snapshot) return undefined;
  try {
    const richTitle = canonicalizePortableRichText(snapshot.content);
    const title = portableRichTextPlainText(richTitle);
    return title ? { title, richTitle } : undefined;
  } catch {
    const title = titleTextFromLegacyContent(snapshot.content);
    return title ? { title, richTitle: plainTextToPortableRichText(title) } : undefined;
  }
};

const pageRecord = (
  record: BlockRecord,
  position: BlockViewPosition | undefined,
  order: number,
  titleContent: BlockContentSnapshot | undefined,
): DatabasePageSummary => {
  const properties = record.properties;
  const fallbackTitle = readString(properties, "title", "name") ?? "Untitled";
  const richTitle = readContentTitle(titleContent) ?? readRichTitle(properties, fallbackTitle);
  const description = readString(properties, "description") ?? "";
  const statusCandidate = position?.groupKey
    ?? readString(properties, "status", "workflowStatus");
  const status: WorkflowStatus = isWorkflowStatus(statusCandidate)
    ? statusCandidate
    : DEFAULT_WORKFLOW_STATUS;
  const created = readDate(properties, "createdAt", "created_at", "created")
    ?? new Date(0);
  const descriptionSummary = summarizePageDescription(description);
  const priority = readString(properties, "priority");
  const estimate = readString(properties, "estimate");

  return {
    id: record.id,
    status,
    archived: false,
    title: richTitle.title || "Untitled",
    richTitle: richTitle.richTitle,
    ...(descriptionSummary),
    tags: readStringList(properties, "tags"),
    ...(priority ? { priority: priority as DatabasePageSummary["priority"] } : {}),
    ...(estimate ? { estimate: estimate as DatabasePageSummary["estimate"] } : {}),
    ...(readDate(properties, "dueDate", "due_date")
      ? { dueDate: readDate(properties, "dueDate", "due_date") } : {}),
    ...(readDate(properties, "scheduledStart", "scheduled_start")
      ? { scheduledStart: readDate(properties, "scheduledStart", "scheduled_start") } : {}),
    ...(readDate(properties, "scheduledEnd", "scheduled_end")
      ? { scheduledEnd: readDate(properties, "scheduledEnd", "scheduled_end") } : {}),
    ...(typeof properties.isAllDay === "boolean" ? { isAllDay: properties.isAllDay } : {}),
    ...(readString(properties, "assignee") ? { assignee: readString(properties, "assignee") } : {}),
    ...(readObject(properties, "recurrence")
      ? { recurrence: readObject(properties, "recurrence") as DatabasePageSummary["recurrence"] } : {}),
    ...(readObjectList(properties, "reminders")
      ? { reminders: readObjectList(properties, "reminders") as DatabasePageSummary["reminders"] } : {}),
    ...(readString(properties, "scheduleTimezone")
      ? { scheduleTimezone: readString(properties, "scheduleTimezone") } : {}),
    ...(readString(properties, "runInTarget")
      ? { runInTarget: readString(properties, "runInTarget") as DatabasePageSummary["runInTarget"] } : {}),
    ...(readString(properties, "runInLocalPath")
      ? { runInLocalPath: readString(properties, "runInLocalPath") } : {}),
    ...(readString(properties, "runInBaseBranch")
      ? { runInBaseBranch: readString(properties, "runInBaseBranch") } : {}),
    ...(readString(properties, "runInWorktreePath")
      ? { runInWorktreePath: readString(properties, "runInWorktreePath") } : {}),
    ...(readString(properties, "runInEnvironmentPath")
      ? { runInEnvironmentPath: readString(properties, "runInEnvironmentPath") } : {}),
    revision: record.revision,
    created,
    order,
  };
};

/** Projects only the visible Board summary; it never materializes Page bodies. */
export const projectBlockRecordWindowToBoard = (
  window: BlockRecordWindow,
): BoardSummary => {
  const positions = window.viewId
    ? window.viewPositions
      .filter((position) => position.viewId === window.viewId)
      .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
    : [];
  const positionByBlockId = new Map(positions.map((position) => [position.blockId, position]));
  const titleByBlockId = new Map(
    window.content
      .filter((snapshot) => snapshot.slot === "title")
      .map((snapshot) => [snapshot.blockId, snapshot]),
  );
  const orderedRecords = window.records
    .filter((record) => record.kind === "page" && record.lifecycle === "active")
    .map((record) => ({
      record,
      position: positionByBlockId.get(record.id),
    }))
    .sort((left, right) => {
      const leftRank = left.position?.rankKey ?? window.placements.find((placement) => placement.blockId === left.record.id)?.rankKey ?? "";
      const rightRank = right.position?.rankKey ?? window.placements.find((placement) => placement.blockId === right.record.id)?.rankKey ?? "";
      return leftRank.localeCompare(rightRank) || left.record.id.localeCompare(right.record.id);
    });

  const columns = new Map<WorkflowStatus, DatabasePageSummary[]>();
  for (const column of WORKFLOW_STATUS_COLUMNS) columns.set(column.id, []);
  orderedRecords.forEach(({ record, position }, index) => {
    const card = pageRecord(record, position, index, titleByBlockId.get(record.id));
    columns.get(card.status)?.push(card);
  });

  return {
    columns: WORKFLOW_STATUS_COLUMNS.map((column) => ({
      ...column,
      cards: columns.get(column.id) ?? [],
    })),
  };
};
