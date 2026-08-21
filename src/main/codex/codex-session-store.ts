import fs from "node:fs";
import path from "node:path";
import type {
  CodexTranscriptEntry,
  CodexThreadDetail,
  CodexThreadSummary,
  CodexThreadTokenUsage,
  CodexTurnSummary,
} from "../../shared/types";
import {
  parseCodexSessionIndexEntryLine,
  parseCodexSessionJsonlLine,
  type CodexSessionIndexEntry,
} from "../../shared/schemas/codex-session";
import { parsePersistedCodexThreadTokenUsage } from "./codex-session-token-usage";
import {
  buildTranscriptFromBootstrapEvents,
  resolveThreadPreviewFromTranscript,
} from "./codex-transcript-projection";
import { projectCodexReasoningSummary } from "../../shared/codex-reasoning-projection";

interface SessionFileMatch {
  filePath: string;
  archived: boolean;
}

interface SessionThreadMaterializationInput {
  threadId: string;
  link: CodexThreadSummary;
  codexHome?: string;
}

export interface CodexSessionThreadMetadata {
  threadId: string;
  parentThreadId: string | null;
  source: unknown;
  threadSource: string | null;
  cwd: string | null;
}

interface MutableTurnRecord {
  threadId: string;
  turnId: string;
  status: CodexTurnSummary["status"];
  errorMessage?: string;
  itemIds: string[];
  tokenUsage?: CodexThreadTokenUsage;
  createdAt: number;
  updatedAt: number;
}

const sessionFileCache = new Map<string, SessionFileMatch | null>();
const sessionIndexCache = new Map<string, CodexSessionIndexEntry>();
let sessionIndexLoadedFromPath: string | null = null;
let sessionFileCacheHome: string | null = null;

function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveHomeDir(): string {
  const envHome = process.env.HOME?.trim();
  if (envHome) return envHome;
  return process.cwd();
}

function resolveRuntimeHomeDir(): string {
  const envInterpreterHome = process.env.INTERPRETER_HOME?.trim();
  if (envInterpreterHome) return envInterpreterHome;
  return path.join(resolveHomeDir(), ".openinterpreter");
}

function loadSessionIndexIfNeeded(codexHome?: string): void {
  const indexPath = path.join(codexHome ?? resolveRuntimeHomeDir(), "session_index.jsonl");
  if (sessionIndexLoadedFromPath === indexPath) return;

  sessionIndexCache.clear();
  sessionIndexLoadedFromPath = indexPath;

  if (!fs.existsSync(indexPath)) return;

  const raw = fs.readFileSync(indexPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = parseCodexSessionIndexEntryLine(trimmed);
    if (!entry) continue;
    sessionIndexCache.set(entry.id, entry);
  }
}

function readSessionIndexEntry(
  threadId: string,
  codexHome?: string,
): CodexSessionIndexEntry | null {
  loadSessionIndexIfNeeded(codexHome);
  return sessionIndexCache.get(threadId) ?? null;
}

function resolveSessionSearchRoots(codexHome: string): SessionFileMatch[] {
  if (sessionFileCacheHome !== codexHome) {
    sessionFileCache.clear();
    sessionFileCacheHome = codexHome;
  }
  return [
    { filePath: path.join(codexHome, "sessions"), archived: false },
    { filePath: path.join(codexHome, "archived_sessions"), archived: true },
  ];
}

function findSessionFileInDirectory(
  directoryPath: string,
  threadId: string,
  archived: boolean,
): SessionFileMatch | null {
  if (!fs.existsSync(directoryPath)) return null;

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findSessionFileInDirectory(entryPath, threadId, archived);
      if (nested) return nested;
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.startsWith("rollout-")) continue;
    if (!entry.name.includes(threadId)) continue;
    if (!entry.name.endsWith(".json") && !entry.name.endsWith(".jsonl")) continue;
    return { filePath: entryPath, archived };
  }

  return null;
}

function resolveSessionFile(
  threadId: string,
  configuredCodexHome?: string,
): SessionFileMatch | null {
  const codexHome = configuredCodexHome ?? resolveRuntimeHomeDir();
  if (sessionFileCacheHome !== codexHome) {
    sessionFileCache.clear();
    sessionFileCacheHome = codexHome;
  }
  if (sessionFileCache.has(threadId)) {
    return sessionFileCache.get(threadId) ?? null;
  }

  for (const root of resolveSessionSearchRoots(codexHome)) {
    const match = findSessionFileInDirectory(root.filePath, threadId, root.archived);
    if (!match) continue;
    sessionFileCache.set(threadId, match);
    return match;
  }

  sessionFileCache.set(threadId, null);
  return null;
}

export function hasCodexSessionMaterialized(threadId: string, codexHome?: string): boolean {
  const match = resolveSessionFile(threadId, codexHome);
  if (!match) return false;

  try {
    return fs.statSync(match.filePath).size > 0;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function normalizeOptionalSessionText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function extractResponseMessageText(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.content)) return "";
  return normalizeText(
    payload.content
      .flatMap((part): string[] => {
        const candidate = asRecord(part);
        return typeof candidate?.text === "string" ? [candidate.text] : [];
      })
      .join("\n"),
  );
}

function hasMatchingReplayMessage(
  transcript: readonly CodexTranscriptEntry[],
  turnId: string,
  role: "user" | "assistant",
  text: string,
): boolean {
  const normalizedText = normalizeText(text);
  return transcript.some(
    (entry) =>
      entry.turnId === turnId &&
      entry.role === role &&
      normalizeText(entry.markdownText ?? "") === normalizedText,
  );
}

function buildReplayItemId(
  threadId: string,
  kind: "user" | "msg" | "reasoning" | "system",
  index: number,
): string {
  return `replay:${kind}:${threadId}:${index}`;
}

function ensureTurn(
  turnsById: Map<string, MutableTurnRecord>,
  threadId: string,
  turnId: string,
  createdAt: number,
): MutableTurnRecord {
  const existing = turnsById.get(turnId);
  if (existing) {
    existing.createdAt = Math.min(existing.createdAt, createdAt);
    existing.updatedAt = Math.max(existing.updatedAt, createdAt);
    return existing;
  }

  const turn: MutableTurnRecord = {
    threadId,
    turnId,
    status: "completed",
    itemIds: [],
    createdAt,
    updatedAt: createdAt,
  };
  turnsById.set(turnId, turn);
  return turn;
}

function addItemToTurn(turn: MutableTurnRecord, itemId: string, timestamp: number): void {
  if (!turn.itemIds.includes(itemId)) {
    turn.itemIds.push(itemId);
  }
  turn.updatedAt = Math.max(turn.updatedAt, timestamp);
}

function appendReplayTranscriptEntry(
  transcript: CodexTranscriptEntry[],
  turn: MutableTurnRecord,
  itemId: string,
  timestamp: number,
  entry: Omit<CodexTranscriptEntry, "sequence">,
): number {
  addItemToTurn(turn, itemId, timestamp);
  const nextIndex = transcript.length;
  transcript.push({
    ...entry,
    sequence: nextIndex,
  });
  return nextIndex;
}

function appendReplayReasoningSummary(
  transcript: CodexTranscriptEntry[],
  turn: MutableTurnRecord,
  threadId: string,
  lineIndex: number,
  timestamp: number,
  summaryText: string,
  rawItem: unknown,
): void {
  const normalizedSummary = normalizeText(summaryText);
  if (normalizedSummary.length === 0) return;

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "reasoning" && previous.turnId === turn.turnId) {
    const nextSummaryParts = [previous.markdownText ?? "", normalizedSummary]
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    previous.markdownText = nextSummaryParts.join("\n\n");
    previous.updatedAt = timestamp;
    previous.rawItem = rawItem;
    addItemToTurn(turn, previous.itemId, timestamp);
    return;
  }

  const itemId = buildReplayItemId(threadId, "reasoning", lineIndex);
  appendReplayTranscriptEntry(transcript, turn, itemId, timestamp, {
    threadId,
    turnId: turn.turnId,
    entryId: itemId,
    itemId,
    type: "reasoning",
    kind: "reasoning",
    semanticKind: "reasoning",
    source: "replay",
    markdownText: normalizedSummary,
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    rawItem,
  });
}

function appendReplayContextCompaction(
  transcript: CodexTranscriptEntry[],
  turn: MutableTurnRecord,
  threadId: string,
  lineIndex: number,
  timestamp: number,
  rawItem: unknown,
): void {
  const previous = transcript[transcript.length - 1];
  if (previous?.semanticKind === "contextCompaction" && previous.turnId === turn.turnId) {
    previous.status = "completed";
    previous.markdownText = "Context automatically compacted";
    previous.updatedAt = timestamp;
    previous.rawItem = rawItem;
    addItemToTurn(turn, previous.itemId, timestamp);
    return;
  }

  const itemId = buildReplayItemId(threadId, "system", lineIndex);
  appendReplayTranscriptEntry(transcript, turn, itemId, timestamp, {
    threadId,
    turnId: turn.turnId,
    entryId: itemId,
    itemId,
    type: "context_compaction",
    kind: "systemEvent",
    semanticKind: "contextCompaction",
    source: "replay",
    markdownText: "Context automatically compacted",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    rawItem,
  });
}

function sortTurns(turnsById: Map<string, MutableTurnRecord>): CodexTurnSummary[] {
  return [...turnsById.values()]
    .sort(
      (a, b) =>
        a.createdAt - b.createdAt || a.updatedAt - b.updatedAt || a.turnId.localeCompare(b.turnId),
    )
    .map((turn) => ({
      threadId: turn.threadId,
      turnId: turn.turnId,
      status: turn.status,
      errorMessage: turn.errorMessage,
      itemIds: turn.itemIds,
      tokenUsage: turn.tokenUsage,
    }));
}

function parseSessionJsonl(
  raw: string,
  input: SessionThreadMaterializationInput,
  fileMatch: SessionFileMatch,
): CodexThreadDetail | null {
  const fallbackTimestamp = input.link.updatedAt || Date.now();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const turnsById = new Map<string, MutableTurnRecord>();
  const transcript: CodexTranscriptEntry[] = [];
  const sessionIndexEntry = readSessionIndexEntry(input.threadId, input.codexHome);

  let currentTurnId = `turn-${input.threadId}`;
  let sessionTimestamp = fallbackTimestamp;
  let sessionCwd = input.link.cwd;
  let lastUpdatedAt = fallbackTimestamp;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const parsedLine = parseCodexSessionJsonlLine(rawLine, fallbackTimestamp);
    if (!parsedLine) continue;
    const { timestamp, type, payload } = parsedLine;
    lastUpdatedAt = Math.max(lastUpdatedAt, timestamp);

    if (type === "session_meta") {
      const metaTimestamp = parseIsoTimestamp(payload?.timestamp);
      if (metaTimestamp !== null) {
        sessionTimestamp = metaTimestamp;
      }
      if (typeof payload?.cwd === "string" && payload.cwd.trim().length > 0) {
        sessionCwd = payload.cwd;
      }
      continue;
    }

    if (type === "turn_context") {
      if (typeof payload?.turn_id === "string" && payload.turn_id.trim().length > 0) {
        currentTurnId = payload.turn_id;
      }
      if (typeof payload?.cwd === "string" && payload.cwd.trim().length > 0) {
        sessionCwd = payload.cwd;
      }
      continue;
    }

    if (type === "compacted") {
      const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
      appendReplayContextCompaction(
        transcript,
        turn,
        input.threadId,
        lineIndex,
        timestamp,
        payload,
      );
      if (turn.status === "inProgress") {
        turn.status = "completed";
      }
      continue;
    }

    if (type === "event_msg") {
      const eventType = payload?.type;
      if (eventType === "task_started") {
        if (typeof payload?.turn_id === "string" && payload.turn_id.trim().length > 0) {
          currentTurnId = payload.turn_id;
        }
        ensureTurn(turnsById, input.threadId, currentTurnId, timestamp).status = "inProgress";
        continue;
      }

      if (eventType === "token_count") {
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        const tokenUsage = parsePersistedCodexThreadTokenUsage(payload?.info);
        if (tokenUsage) {
          turn.tokenUsage = tokenUsage;
        }
        if (turn.status === "inProgress") {
          turn.status = "completed";
        }
        continue;
      }

      if (
        eventType === "user_message" &&
        typeof payload?.message === "string" &&
        payload.message.trim().length > 0
      ) {
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        if (hasMatchingReplayMessage(transcript, turn.turnId, "user", payload.message)) continue;
        const itemId = buildReplayItemId(input.threadId, "user", lineIndex);
        appendReplayTranscriptEntry(transcript, turn, itemId, timestamp, {
          threadId: input.threadId,
          turnId: turn.turnId,
          entryId: itemId,
          itemId,
          type: "userMessage",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          source: "replay",
          markdownText: normalizeText(payload.message),
          status: "completed",
          createdAt: timestamp,
          updatedAt: timestamp,
          rawItem: payload,
        });
        continue;
      }

      if (
        eventType === "agent_message" &&
        typeof payload?.message === "string" &&
        payload.message.trim().length > 0
      ) {
        const assistantPhase = typeof payload.phase === "string" ? payload.phase : null;
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        if (hasMatchingReplayMessage(transcript, turn.turnId, "assistant", payload.message))
          continue;
        const itemId = buildReplayItemId(input.threadId, "msg", lineIndex);
        appendReplayTranscriptEntry(transcript, turn, itemId, timestamp, {
          threadId: input.threadId,
          turnId: turn.turnId,
          entryId: itemId,
          itemId,
          type: "agentMessage",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          assistantPhase: assistantPhase ?? undefined,
          role: "assistant",
          source: "replay",
          markdownText: normalizeText(payload.message),
          status: "completed",
          createdAt: timestamp,
          updatedAt: timestamp,
          rawItem: payload,
        });
        continue;
      }

      if (
        eventType === "agent_reasoning" &&
        typeof payload?.text === "string" &&
        payload.text.trim().length > 0
      ) {
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        appendReplayReasoningSummary(
          transcript,
          turn,
          input.threadId,
          lineIndex,
          timestamp,
          payload.text,
          payload,
        );
      }

      if (eventType === "context_compacted") {
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        appendReplayContextCompaction(
          transcript,
          turn,
          input.threadId,
          lineIndex,
          timestamp,
          payload,
        );
        if (turn.status === "inProgress") {
          turn.status = "completed";
        }
      }
      continue;
    }

    if (type !== "response_item" || !payload) continue;

    const responseType = payload.type;
    const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);

    if (responseType === "message") {
      const role = payload.role === "user" || payload.role === "assistant" ? payload.role : null;
      const text = extractResponseMessageText(payload);
      if (!role || !text || hasMatchingReplayMessage(transcript, turn.turnId, role, text)) continue;

      const itemId =
        typeof payload.id === "string" && payload.id.trim().length > 0
          ? payload.id
          : buildReplayItemId(input.threadId, role === "user" ? "user" : "msg", lineIndex);
      appendReplayTranscriptEntry(transcript, turn, itemId, timestamp, {
        threadId: input.threadId,
        turnId: turn.turnId,
        entryId: itemId,
        itemId,
        type: role === "user" ? "userMessage" : "agentMessage",
        kind: role === "user" ? "userMessage" : "assistantMessage",
        semanticKind: role === "user" ? "userMessage" : "assistantMessage",
        role,
        source: "replay",
        markdownText: text,
        status: "completed",
        createdAt: timestamp,
        updatedAt: timestamp,
        rawItem: payload,
      });
      continue;
    }

    if (responseType === "reasoning") {
      appendReplayReasoningSummary(
        transcript,
        turn,
        input.threadId,
        lineIndex,
        timestamp,
        projectCodexReasoningSummary(payload.summary),
        payload,
      );
      if (turn.status === "inProgress") {
        turn.status = "completed";
      }
      continue;
    }

    if (responseType === "compaction") {
      appendReplayContextCompaction(
        transcript,
        turn,
        input.threadId,
        lineIndex,
        timestamp,
        payload,
      );
      if (turn.status === "inProgress") {
        turn.status = "completed";
      }
      continue;
    }

    // Responses JSONL calls do not carry the generated v2 ThreadItem contract.
    // Fail closed: canonical app-server resume owns every tool-family projection.
    if (
      responseType === "function_call" ||
      responseType === "web_search_call" ||
      responseType === "function_call_output"
    )
      continue;
  }

  const turns = sortTurns(turnsById);
  if (turns.length === 0) return null;
  const orderedTranscript = buildTranscriptFromBootstrapEvents({
    transcript,
    source: "replay",
  });

  const updatedAt = sessionIndexEntry?.updatedAt ?? lastUpdatedAt;
  return {
    ...input.link,
    threadName: sessionIndexEntry?.threadName ?? input.link.threadName,
    threadPreview: resolveThreadPreviewFromTranscript(orderedTranscript, input.link.threadPreview),
    cwd: sessionCwd,
    archived: input.link.archived || fileMatch.archived,
    createdAt: input.link.createdAt || sessionTimestamp,
    updatedAt: updatedAt ?? input.link.updatedAt,
    turns,
    transcript: orderedTranscript,
  };
}

export function readCodexSessionThreadDetail(
  input: SessionThreadMaterializationInput,
): CodexThreadDetail | null {
  const match = resolveSessionFile(input.threadId, input.codexHome);
  if (!match) return null;

  try {
    const raw = fs.readFileSync(match.filePath, "utf8");
    if (!raw.trim()) return null;

    if (match.filePath.endsWith(".jsonl")) {
      return parseSessionJsonl(raw, input, match);
    }
    return null;
  } catch {
    return null;
  }
}

export function readCodexSessionThreadMetadata(
  threadId: string,
  codexHome?: string,
): CodexSessionThreadMetadata | null {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return null;

  const match = resolveSessionFile(normalizedThreadId, codexHome);
  if (!match) return null;

  try {
    const raw = fs.readFileSync(match.filePath, "utf8");
    if (!raw.trim() || !match.filePath.endsWith(".jsonl")) return null;

    const fallbackTimestamp = Date.now();
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parsedLine = parseCodexSessionJsonlLine(line, fallbackTimestamp);
      if (!parsedLine || parsedLine.type !== "session_meta") continue;

      const payload = asRecord(parsedLine.payload);
      if (!payload) return null;
      return {
        threadId: normalizeOptionalSessionText(payload.id) ?? normalizedThreadId,
        parentThreadId: normalizeOptionalSessionText(
          payload.parent_thread_id ?? payload.parentThreadId,
        ),
        source: payload.source ?? null,
        threadSource: normalizeOptionalSessionText(payload.thread_source ?? payload.threadSource),
        cwd: normalizeOptionalSessionText(payload.cwd),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function resetCodexSessionStoreCaches(): void {
  sessionFileCache.clear();
  sessionIndexCache.clear();
  sessionFileCacheHome = null;
  sessionIndexLoadedFromPath = null;
}
