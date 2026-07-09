import type {
  CodexConversationSnapshot,
  CodexThreadDetail,
  CommandPaletteSearchSnippetSegment,
} from "../../shared/types";
import { tokenizeSearchQuery } from "../../shared/search-text";
import { buildCodexTurnOccurrenceKey } from "../../shared/codex-turn-identity";

export interface ThreadSearchUnit {
  unitKey: string;
  threadId: string;
  turnId: string;
  itemId: string;
  role: "user" | "assistant";
  text: string;
}

const FTS_HIGHLIGHT_START = "\u0001";
const FTS_HIGHLIGHT_END = "\u0002";

function isSearchableRole(role: unknown): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

export function buildThreadSearchUnitKey(input: {
  threadId: string;
  turnId: string;
  itemId: string;
  role: "user" | "assistant";
}): string {
  return `${input.threadId}:${input.turnId}:${input.itemId}:${input.role}`;
}

export function extractThreadSearchUnitsFromConversation(
  conversation: CodexConversationSnapshot | null,
): ThreadSearchUnit[] {
  if (!conversation) return [];

  return conversation.turns.flatMap((turn, turnIndex) => {
    const turnKey = buildCodexTurnOccurrenceKey(turn.turnId, turnIndex);
    return turn.items.flatMap((item): ThreadSearchUnit[] => {
      const role = item.role;
      const text = (item.markdownText ?? "").trim();
      if (!isSearchableRole(role) || !text) return [];
      return [{
        unitKey: buildThreadSearchUnitKey({
          threadId: conversation.threadId,
          turnId: turnKey,
          itemId: item.itemId,
          role,
        }),
        threadId: conversation.threadId,
        turnId: turnKey,
        itemId: item.itemId,
        role,
        text,
      }];
    });
  });
}

export function extractThreadSearchUnitsFromDetail(
  detail: CodexThreadDetail | null,
): ThreadSearchUnit[] {
  if (!detail) return [];

  return detail.transcript.flatMap((entry): ThreadSearchUnit[] => {
    const role = entry.role;
    const text = (entry.markdownText ?? "").trim();
    if (!isSearchableRole(role) || !text) return [];
    if (entry.kind !== "userMessage" && entry.kind !== "assistantMessage") return [];

    const turnIndex = detail.turns.findIndex((turn) => turn.turnId === null
      ? turn.itemIds.includes(entry.itemId)
      : turn.turnId === entry.turnId);
    const turnKey = buildCodexTurnOccurrenceKey(
      entry.turnId,
      Math.max(0, turnIndex),
    );
    return [{
      unitKey: buildThreadSearchUnitKey({
        threadId: detail.threadId,
        turnId: turnKey,
        itemId: entry.itemId,
        role,
      }),
      threadId: detail.threadId,
      turnId: turnKey,
      itemId: entry.itemId,
      role,
      text,
    }];
  });
}

function tokenizeFtsQuery(query: string): string[] {
  return tokenizeSearchQuery(query)
    .flatMap((token) => token.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .map((token) => token.trim().toLowerCase())
    .filter((token, index, values) => token.length > 0 && values.indexOf(token) === index);
}

export function buildThreadContentFtsMatchQuery(query: string): string | null {
  const tokens = tokenizeFtsQuery(query);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}*`).join(" ");
}

export function getThreadContentFtsMarkers(): {
  start: string;
  end: string;
} {
  return {
    start: FTS_HIGHLIGHT_START,
    end: FTS_HIGHLIGHT_END,
  };
}

export function parseMarkedSnippetSegments(
  markedSnippet: string,
  markers = getThreadContentFtsMarkers(),
): CommandPaletteSearchSnippetSegment[] {
  const segments: CommandPaletteSearchSnippetSegment[] = [];
  let index = 0;
  let highlighted = false;

  while (index < markedSnippet.length) {
    const nextStart = markedSnippet.indexOf(markers.start, index);
    const nextEnd = markedSnippet.indexOf(markers.end, index);
    const nextMarker = [nextStart, nextEnd]
      .filter((value) => value >= 0)
      .sort((left, right) => left - right)[0] ?? -1;

    if (nextMarker === -1) {
      const text = markedSnippet.slice(index);
      if (text) segments.push({ text, highlight: highlighted });
      break;
    }

    if (nextMarker > index) {
      segments.push({
        text: markedSnippet.slice(index, nextMarker),
        highlight: highlighted,
      });
    }

    if (nextMarker === nextStart) {
      highlighted = true;
      index = nextMarker + markers.start.length;
    } else {
      highlighted = false;
      index = nextMarker + markers.end.length;
    }
  }

  return segments.length > 0 ? segments : [{ text: markedSnippet, highlight: false }];
}
