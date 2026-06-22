import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parseCodexSessionJsonlLine } from "../../shared/schemas/codex-session";
import {
  buildThreadSearchUnitKey,
  type ThreadSearchUnit,
} from "./command-palette-thread-search-helpers";

interface SessionFileMatch {
  filePath: string;
}

const sessionFileCache = new Map<string, SessionFileMatch | null>();
let sessionFileCacheHome: string | null = null;

function resolveHomeDir(): string {
  const envHome = process.env.HOME?.trim();
  return envHome || process.cwd();
}

function resolveCodexHomeDir(): string {
  const envCodexHome = process.env.CODEX_HOME?.trim();
  return envCodexHome || path.join(resolveHomeDir(), ".codex");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function buildReplayItemId(
  threadId: string,
  kind: "user" | "msg",
  index: number,
): string {
  return `replay:${kind}:${threadId}:${index}`;
}

function resolveSessionSearchRoots(): string[] {
  const codexHome = resolveCodexHomeDir();
  if (sessionFileCacheHome !== codexHome) {
    sessionFileCache.clear();
    sessionFileCacheHome = codexHome;
  }
  return [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions"),
  ];
}

async function findSessionFileInDirectory(
  directoryPath: string,
  threadId: string,
): Promise<SessionFileMatch | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSessionFileInDirectory(entryPath, threadId);
      if (nested) return nested;
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.startsWith("rollout-")) continue;
    if (!entry.name.includes(threadId)) continue;
    if (!entry.name.endsWith(".jsonl")) continue;
    return { filePath: entryPath };
  }

  return null;
}

async function resolveSessionFile(threadId: string): Promise<SessionFileMatch | null> {
  if (sessionFileCache.has(threadId)) {
    return sessionFileCache.get(threadId) ?? null;
  }

  for (const root of resolveSessionSearchRoots()) {
    const match = await findSessionFileInDirectory(root, threadId);
    if (!match) continue;
    sessionFileCache.set(threadId, match);
    return match;
  }

  sessionFileCache.set(threadId, null);
  return null;
}

export async function readThreadSearchUnitsFromSession(
  threadId: string,
  fallbackUpdatedAt: number,
): Promise<ThreadSearchUnit[] | null> {
  const match = await resolveSessionFile(threadId);
  if (!match) return null;

  const stream = fs.createReadStream(match.filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const units: ThreadSearchUnit[] = [];
  let currentTurnId = `turn-${threadId}`;
  let lineIndex = 0;

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        lineIndex += 1;
        continue;
      }

      const parsedLine = parseCodexSessionJsonlLine(trimmed, fallbackUpdatedAt);
      lineIndex += 1;
      if (!parsedLine) continue;

      const { type, payload } = parsedLine;
      if (type === "turn_context") {
        if (typeof payload?.turn_id === "string" && payload.turn_id.trim().length > 0) {
          currentTurnId = payload.turn_id;
        }
        continue;
      }

      if (type !== "event_msg") continue;
      const eventType = payload?.type;
      if (eventType === "task_started") {
        if (typeof payload?.turn_id === "string" && payload.turn_id.trim().length > 0) {
          currentTurnId = payload.turn_id;
        }
        continue;
      }

      const role = eventType === "user_message"
        ? "user"
        : eventType === "agent_message"
          ? "assistant"
          : null;
      if (!role || typeof payload?.message !== "string") continue;

      const text = normalizeText(payload.message);
      if (!text) continue;

      const itemId = buildReplayItemId(threadId, role === "user" ? "user" : "msg", lineIndex);
      units.push({
        unitKey: buildThreadSearchUnitKey({
          threadId,
          turnId: currentTurnId,
          itemId,
          role,
        }),
        threadId,
        turnId: currentTurnId,
        itemId,
        role,
        text,
      });
    }
  } finally {
    lines.close();
  }

  return units;
}

export function resetThreadSearchSessionReaderCachesForTests(): void {
  sessionFileCache.clear();
  sessionFileCacheHome = null;
}
