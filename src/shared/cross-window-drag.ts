import type {
  BlockDropImportSourceUpdate,
  CardCreateInput,
  CardStatus,
  CardSummary,
} from "./types";

export const NODEX_NFM_BLOCKS_DRAG_MIME = "application/vnd.nodex.nfm-blocks+json";
export const NODEX_KANBAN_CARDS_DRAG_MIME = "application/vnd.nodex.kanban-cards+json";
export const CROSS_WINDOW_DRAG_TOKEN_VERSION = 1 as const;

export type CrossWindowDragKind = "blocks" | "cards";
export type DragTransferOperation = "move" | "copy";

export interface CrossWindowDragToken {
  version: typeof CROSS_WINDOW_DRAG_TOKEN_VERSION;
  sessionId: string;
}

export interface CrossWindowCardDragItem {
  card: CardSummary;
  columnId: CardStatus;
  columnName: string;
}

export interface CrossWindowCardDragPayload {
  projectId: string;
  cards: CrossWindowCardDragItem[];
}

export interface CrossWindowBlockDragPayload {
  cards: CardCreateInput[];
  sourceUpdates: BlockDropImportSourceUpdate[];
  groupId: string;
}

export type CrossWindowDragStartInput =
  | {
      version: typeof CROSS_WINDOW_DRAG_TOKEN_VERSION;
      sessionId: string;
      kind: "blocks";
      payload: CrossWindowBlockDragPayload;
    }
  | {
      version: typeof CROSS_WINDOW_DRAG_TOKEN_VERSION;
      sessionId: string;
      kind: "cards";
      payload: CrossWindowCardDragPayload;
      groupId: string;
    };

export type CrossWindowDragPreview =
  | {
      version: typeof CROSS_WINDOW_DRAG_TOKEN_VERSION;
      sessionId: string;
      kind: "blocks";
      cards: CardCreateInput[];
    }
  | {
      version: typeof CROSS_WINDOW_DRAG_TOKEN_VERSION;
      sessionId: string;
      kind: "cards";
      payload: CrossWindowCardDragPayload;
    };

export interface CrossWindowDragClaimInput {
  sessionId: string;
  kind: CrossWindowDragKind;
}

export type CrossWindowDragClaimResult =
  | {
      kind: "blocks";
      payload: CrossWindowBlockDragPayload;
    }
  | {
      kind: "cards";
      payload: CrossWindowCardDragPayload;
      groupId: string;
    };

export interface CrossWindowDragCompleteInput {
  sessionId: string;
  result: DragTransferOperation | "cancel";
}

export interface CrossWindowDragSourceResult {
  sessionId: string;
  result: DragTransferOperation | "cancel";
}

export function encodeCrossWindowDragToken(sessionId: string): string {
  return JSON.stringify({
    version: CROSS_WINDOW_DRAG_TOKEN_VERSION,
    sessionId,
  } satisfies CrossWindowDragToken);
}

export function parseCrossWindowDragToken(value: string | null): CrossWindowDragToken | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<CrossWindowDragToken>;
    if (parsed.version !== CROSS_WINDOW_DRAG_TOKEN_VERSION) return null;
    if (
      typeof parsed.sessionId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.sessionId)
    ) return null;
    return {
      version: CROSS_WINDOW_DRAG_TOKEN_VERSION,
      sessionId: parsed.sessionId,
    };
  } catch {
    return null;
  }
}

export function resolveDragTransferOperation(altKey: boolean): DragTransferOperation {
  return altKey ? "copy" : "move";
}

export function formatDragDropLabel(
  operation: DragTransferOperation,
  detail?: string,
): string | undefined {
  if (operation === "copy") {
    return detail ? `Copy · ${detail}` : "Copy";
  }
  return detail;
}
