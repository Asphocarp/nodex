import { z } from "zod";
import { isCardStatus, type CardStatus } from "../card-status";

function assertValidIsoCalendarDate(fieldName: string, value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return;

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${fieldName} "${value}"`);
  }
}

function parseDateOnlyUtc(fieldName: string, value: string): Date {
  assertValidIsoCalendarDate(fieldName, value);
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDueDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  if (value instanceof Date) return value;
  if (typeof value !== "string") {
    throw new Error("Invalid dueDate value");
  }

  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parseDateOnlyUtc("dueDate", value).toISOString()
    : value;
  assertValidIsoCalendarDate("dueDate", candidate);
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid dueDate "${value}"`);
  }
  return parsed;
}

function parseScheduledDate(fieldName: string, value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value !== "string") throw new Error(`Invalid ${fieldName} value`);
  assertValidIsoCalendarDate(fieldName, value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName} "${value}"`);
  }
  return parsed;
}

function parseOptionalBoolean(fieldName: string, value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  throw new Error(`Invalid ${fieldName} value`);
}

function normalizeCardBodyObject(body: Record<string, unknown>): Record<string, unknown> {
  const result = { ...body };
  if (Object.hasOwn(result, "dueDate")) {
    result.dueDate = parseDueDate(result.dueDate);
  }
  if (Object.hasOwn(result, "scheduledStart")) {
    result.scheduledStart = parseScheduledDate("scheduledStart", result.scheduledStart);
  }
  if (Object.hasOwn(result, "scheduledEnd")) {
    result.scheduledEnd = parseScheduledDate("scheduledEnd", result.scheduledEnd);
  }
  if (Object.hasOwn(result, "isAllDay")) {
    result.isAllDay = parseOptionalBoolean("isAllDay", result.isAllDay);
  }
  return result;
}

const UnknownRecordSchema = z.record(z.string(), z.unknown());

export const HttpCardBodySchema = UnknownRecordSchema.transform((body) => normalizeCardBodyObject(body));

export const HttpNestedCardInputSchema = z.unknown().transform((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return HttpCardBodySchema.parse(value);
});

const HttpSourceUpdateSchema = UnknownRecordSchema.transform((body) => ({
  ...body,
  updates: HttpNestedCardInputSchema.parse(body.updates),
}));

export const HttpBlockDropImportBodySchema = UnknownRecordSchema.transform((body) => ({
  ...body,
  cards: Array.isArray(body.cards)
    ? body.cards.map((card) => HttpNestedCardInputSchema.parse(card))
    : body.cards,
  sourceUpdates: Array.isArray(body.sourceUpdates)
    ? body.sourceUpdates.map((item) => HttpSourceUpdateSchema.parse(item))
    : body.sourceUpdates,
}));

export const HttpCardEditorDropBodySchema = UnknownRecordSchema.transform((body) => ({
  ...body,
  targetUpdates: Array.isArray(body.targetUpdates)
    ? body.targetUpdates.map((item) => HttpSourceUpdateSchema.parse(item))
    : body.targetUpdates,
}));

export function parseOptionalCardStatus(value: unknown): CardStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isCardStatus(value)) {
    throw new Error("Invalid status");
  }
  return value;
}
