import {
  canonicalizePortableRichText,
  plainTextToPortableRichText,
  portableRichTextPlainText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import type { PageRunInTarget, RecurrenceConfig, ReminderConfig } from "../../shared/types";
import type { PageStagePageModel } from "./page-stage-page";
import type { BlockRecordWindow } from "../../shared/block-records";

const stringProperty = (
  properties: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
};

const booleanProperty = (
  properties: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
): boolean => typeof properties[key] === "boolean" ? properties[key] as boolean : fallback;

const dateProperty = (
  properties: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): Date => {
  const value = stringProperty(properties, ...keys);
  if (!value) return new Date(0);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
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

const titleFromContent = (value: unknown): {
  title: string;
  richTitle: PortableRichText;
} | undefined => {
  try {
    const richTitle = canonicalizePortableRichText(value);
    const title = portableRichTextPlainText(richTitle);
    return title ? { title, richTitle } : undefined;
  } catch {
    const title = titleTextFromLegacyContent(value);
    return title ? { title, richTitle: plainTextToPortableRichText(title) } : undefined;
  }
};

const runTarget = (value: unknown): PageRunInTarget | undefined =>
  value === "localProject" || value === "newWorktree" || value === "cloud"
    ? value
    : undefined;

const recurrence = (value: unknown): RecurrenceConfig | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as RecurrenceConfig
    : undefined;

const reminders = (value: unknown): readonly ReminderConfig[] =>
  Array.isArray(value)
    ? value.filter((candidate): candidate is ReminderConfig => (
      candidate !== null
      && typeof candidate === "object"
      && typeof (candidate as { readonly offsetMinutes?: unknown }).offsetMinutes === "number"
    ))
    : [];

/**
 * Builds the minimal Page shell needed by PageStage directly from the
 * BlockRecord window. Legacy Page Detail may still enrich metadata when it is
 * available, but it is never required to discover or mount a Page body.
 */
export const projectBlockRecordWindowToPageStageModel = (
  window: BlockRecordWindow,
  pageId: string,
): PageStagePageModel | null => {
  const record = window.records.find((candidate) => candidate.id === pageId);
  if (!record || record.kind !== "page") return null;
  const properties = record.properties;
  const contentTitle = window.content.find((candidate) =>
    candidate.blockId === pageId && candidate.slot === "title",
  );
  const title = titleFromContent(contentTitle?.content)
    ?? (() => {
      const fallback = stringProperty(properties, "title", "name") ?? "Untitled";
      return { title: fallback, richTitle: plainTextToPortableRichText(fallback) };
    })();
  const runTargetValue = runTarget(properties.runTarget ?? properties["run.target"]);

  return {
    page: {
      id: pageId,
      archived: record.lifecycle !== "active",
      title: title.title,
      richTitle: title.richTitle,
      isAllDay: booleanProperty(properties, "isAllDay", false),
      recurrence: recurrence(properties.recurrence),
      reminders: reminders(properties.reminders),
      scheduleTimezone: stringProperty(properties, "scheduleTimezone", "timezone"),
      ...(runTargetValue ? { runInTarget: runTargetValue } : {}),
      runInLocalPath: stringProperty(properties, "runLocalPath", "run.localPath"),
      runInBaseBranch: stringProperty(properties, "runBaseBranch", "run.baseBranch"),
      runInWorktreePath: stringProperty(properties, "runWorktreePath", "run.worktreePath"),
      runInEnvironmentPath: stringProperty(properties, "runEnvironmentPath", "run.environmentPath"),
      revision: record.revision,
      created: dateProperty(properties, "createdAt", "created_at", "created"),
    },
    databaseContext: { kind: "standalone" },
  };
};
