import fs from "node:fs";
import path from "node:path";
import type {
  CodexTranscriptEntry,
  CodexThreadDetail,
  CodexThreadSummary,
  CodexThreadTokenUsage,
  CodexToolCallSubtype,
  CodexTurnSummary,
} from "../../shared/types";
import {
  parseCodexSessionIndexEntryLine,
  parseCodexSessionJsonlLine,
  type CodexSessionIndexEntry,
} from "../../shared/schemas/codex-session";
import { parseCodexThreadTokenUsage } from "../../shared/schemas/codex";
import {
  buildTranscriptFromBootstrapEvents,
  resolveThreadPreviewFromTranscript,
} from "./codex-transcript-projection";
import { projectCodexReasoningSummary } from "./codex-reasoning-projection";

interface SessionFileMatch {
  filePath: string;
  archived: boolean;
}

interface SessionThreadMaterializationInput {
  threadId: string;
  link: CodexThreadSummary;
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

function resolveCodexHomeDir(): string {
  const envCodexHome = process.env.CODEX_HOME?.trim();
  if (envCodexHome) return envCodexHome;
  return path.join(resolveHomeDir(), ".codex");
}

function loadSessionIndexIfNeeded(): void {
  const indexPath = path.join(resolveCodexHomeDir(), "session_index.jsonl");
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

function readSessionIndexEntry(threadId: string): CodexSessionIndexEntry | null {
  loadSessionIndexIfNeeded();
  return sessionIndexCache.get(threadId) ?? null;
}

function resolveSessionSearchRoots(): SessionFileMatch[] {
  const codexHome = resolveCodexHomeDir();
  if (sessionFileCacheHome !== codexHome) {
    sessionFileCache.clear();
    sessionFileCacheHome = codexHome;
  }
  return [
    { filePath: path.join(codexHome, "sessions"), archived: false },
    { filePath: path.join(codexHome, "archived_sessions"), archived: true },
  ];
}

function findSessionFileInDirectory(directoryPath: string, threadId: string, archived: boolean): SessionFileMatch | null {
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

function resolveSessionFile(threadId: string): SessionFileMatch | null {
  if (sessionFileCache.has(threadId)) {
    return sessionFileCache.get(threadId) ?? null;
  }

  for (const root of resolveSessionSearchRoots()) {
    const match = findSessionFileInDirectory(root.filePath, threadId, root.archived);
    if (!match) continue;
    sessionFileCache.set(threadId, match);
    return match;
  }

  sessionFileCache.set(threadId, null);
  return null;
}

export function hasCodexSessionMaterialized(threadId: string): boolean {
  const match = resolveSessionFile(threadId);
  if (!match) return false;

  try {
    return fs.statSync(match.filePath).size > 0;
  } catch {
    return false;
  }
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function buildReplayItemId(
  threadId: string,
  kind: "user" | "msg" | "reasoning" | "tool" | "tool-output" | "system",
  index: number,
): string {
  return `replay:${kind}:${threadId}:${index}`;
}

function resolveToolSubtype(toolName: string): CodexToolCallSubtype {
  if (toolName === "exec_command") return "command";
  if (toolName === "apply_patch") return "fileChange";
  if (toolName.includes("search")) return "webSearch";
  return "generic";
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
  addItemToTurn(turn, itemId, timestamp);
  transcript.push({
    threadId,
    turnId: turn.turnId,
    entryId: itemId,
    itemId,
    type: "reasoning",
    kind: "reasoning",
    semanticKind: "reasoning",
    source: "replay",
    sequence: transcript.length,
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
  addItemToTurn(turn, itemId, timestamp);
  transcript.push({
    threadId,
    turnId: turn.turnId,
    entryId: itemId,
    itemId,
    type: "context_compaction",
    kind: "systemEvent",
    semanticKind: "contextCompaction",
    source: "replay",
    sequence: transcript.length,
    markdownText: "Context automatically compacted",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    rawItem,
  });
}

function sortTurns(turnsById: Map<string, MutableTurnRecord>): CodexTurnSummary[] {
  return [...turnsById.values()]
    .sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt || a.turnId.localeCompare(b.turnId))
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
  const toolIndexByCallId = new Map<string, number>();
  const sessionIndexEntry = readSessionIndexEntry(input.threadId);

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
        const tokenUsage = parseCodexThreadTokenUsage(payload?.info);
        if (tokenUsage) {
          turn.tokenUsage = tokenUsage;
        }
        if (turn.status === "inProgress") {
          turn.status = "completed";
        }
        continue;
      }

      if (eventType === "user_message" && typeof payload?.message === "string" && payload.message.trim().length > 0) {
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        const itemId = buildReplayItemId(input.threadId, "user", lineIndex);
        addItemToTurn(turn, itemId, timestamp);
        transcript.push({
          threadId: input.threadId,
          turnId: turn.turnId,
          entryId: itemId,
          itemId,
          type: "userMessage",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          source: "replay",
          sequence: transcript.length,
          markdownText: normalizeText(payload.message),
          status: "completed",
          createdAt: timestamp,
          updatedAt: timestamp,
          rawItem: payload,
        });
        continue;
      }

      if (eventType === "agent_message" && typeof payload?.message === "string" && payload.message.trim().length > 0) {
        const assistantPhase = typeof payload.phase === "string" ? payload.phase : null;
        const turn = ensureTurn(turnsById, input.threadId, currentTurnId, timestamp);
        const itemId = buildReplayItemId(input.threadId, "msg", lineIndex);
        addItemToTurn(turn, itemId, timestamp);
        transcript.push({
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
          sequence: transcript.length,
          markdownText: normalizeText(payload.message),
          status: "completed",
          createdAt: timestamp,
          updatedAt: timestamp,
          rawItem: payload,
        });
        continue;
      }

      if (eventType === "agent_reasoning" && typeof payload?.text === "string" && payload.text.trim().length > 0) {
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

    if (responseType === "message") continue;

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

    if (responseType === "function_call" || responseType === "web_search_call") {
      const toolName = typeof payload.name === "string"
        ? payload.name
        : responseType === "web_search_call"
          ? "web_search"
          : "tool";
      const itemId = typeof payload.call_id === "string" && payload.call_id.trim().length > 0
        ? payload.call_id
        : buildReplayItemId(input.threadId, "tool", lineIndex);
      const item: CodexTranscriptEntry = {
        threadId: input.threadId,
        turnId: turn.turnId,
        entryId: itemId,
        itemId,
        type: responseType,
        kind: "toolCall",
        semanticKind: responseType === "web_search_call" ? "webSearch" : "toolCall",
        status: "inProgress",
        source: "replay",
        sequence: transcript.length,
        toolCall: {
          subtype: responseType === "web_search_call" ? "webSearch" : resolveToolSubtype(toolName),
          toolName,
          args: parseJsonString(payload.arguments),
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        rawItem: payload,
      };
      addItemToTurn(turn, itemId, timestamp);
      toolIndexByCallId.set(itemId, transcript.length);
      transcript.push(item);
      continue;
    }

    if (responseType === "function_call_output") {
      const callId = typeof payload.call_id === "string" && payload.call_id.trim().length > 0
        ? payload.call_id
        : buildReplayItemId(input.threadId, "tool-output", lineIndex);
      const existingIndex = toolIndexByCallId.get(callId);
      if (existingIndex !== undefined) {
        const existing = transcript[existingIndex];
        if (existing) {
          transcript[existingIndex] = {
            ...existing,
            status: "completed",
            updatedAt: timestamp,
            toolCall: existing.toolCall
              ? {
                  ...existing.toolCall,
                  result: parseJsonString(payload.output),
                }
              : undefined,
          };
          addItemToTurn(turn, callId, timestamp);
        }
        if (turn.status === "inProgress") {
          turn.status = "completed";
        }
        continue;
      }

      const itemId = callId;
      addItemToTurn(turn, itemId, timestamp);
      transcript.push({
        threadId: input.threadId,
        turnId: turn.turnId,
        entryId: itemId,
        itemId,
        type: "function_call_output",
        kind: "toolCall",
        semanticKind: "toolCall",
        status: "completed",
        source: "replay",
        sequence: transcript.length,
        toolCall: {
          subtype: "generic",
          toolName: "tool",
          result: parseJsonString(payload.output),
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        rawItem: payload,
      });
      if (turn.status === "inProgress") {
        turn.status = "completed";
      }
    }
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
  const match = resolveSessionFile(input.threadId);
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

export function resetCodexSessionStoreCaches(): void {
  sessionFileCache.clear();
  sessionIndexCache.clear();
  sessionFileCacheHome = null;
  sessionIndexLoadedFromPath = null;
}
