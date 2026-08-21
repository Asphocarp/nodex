import { z } from "zod";
import { CodexUnknownRecordSchema } from "./codex";

export interface CodexSessionIndexEntry {
  id: string;
  threadName: string | null;
  updatedAt: number | null;
}

export interface ParsedCodexSessionLine {
  timestamp: number;
  type: string;
  payload: Record<string, unknown> | null;
}

const NonEmptyStringSchema = z.string().min(1);

function parseIsoTimestamp(value: unknown): number | null {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) return null;

  const timestamp = Date.parse(parsed.data);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseJsonLine(rawLine: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawLine) as unknown;
    const candidate = CodexUnknownRecordSchema.safeParse(parsed);
    return candidate.success ? candidate.data : null;
  } catch {
    return null;
  }
}

export function parseCodexSessionIndexEntryLine(rawLine: string): CodexSessionIndexEntry | null {
  const candidate = parseJsonLine(rawLine);
  if (!candidate) return null;

  const id = NonEmptyStringSchema.safeParse(candidate.id);
  if (!id.success) return null;

  const threadName = z.string().safeParse(candidate.thread_name).success
    ? (candidate.thread_name as string)
    : z.string().safeParse(candidate.threadName).success
      ? (candidate.threadName as string)
      : null;

  return {
    id: id.data,
    threadName,
    updatedAt: parseIsoTimestamp(candidate.updated_at ?? candidate.updatedAt),
  };
}

export function parseCodexSessionJsonlLine(
  rawLine: string,
  fallbackTimestamp: number,
): ParsedCodexSessionLine | null {
  const candidate = parseJsonLine(rawLine);
  if (!candidate) return null;

  const type = NonEmptyStringSchema.safeParse(candidate.type);
  if (!type.success) return null;

  const payload = CodexUnknownRecordSchema.safeParse(candidate.payload);
  return {
    timestamp: parseIsoTimestamp(candidate.timestamp) ?? fallbackTimestamp,
    type: type.data,
    payload: payload.success ? payload.data : null,
  };
}
