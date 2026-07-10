import type {
  CrossWindowCardDragItem,
  CrossWindowCardDragPayload,
} from "../../../../shared/cross-window-drag";

export type ExternalCardDragCard = CrossWindowCardDragItem["card"];

export interface CardDragPointer {
  x: number;
  y: number;
}

export type ExternalCardDragItem = CrossWindowCardDragItem;
export type ExternalCardDragPayload = CrossWindowCardDragPayload;

export interface ExternalCardDragSession {
  id: string;
  payload: ExternalCardDragPayload;
  pointer: CardDragPointer | null;
  groupId: string;
}

let activeSession: ExternalCardDragSession | null = null;

export function startExternalCardDragSession(
  payload: ExternalCardDragPayload,
  options?: { id?: string; groupId?: string },
): string {
  const id = options?.id ?? crypto.randomUUID();
  activeSession = {
    id,
    payload,
    pointer: null,
    groupId: options?.groupId ?? crypto.randomUUID(),
  };
  return id;
}

export function getActiveExternalCardDragSession(): ExternalCardDragSession | null {
  return activeSession;
}

export function updateExternalCardDragPointer(
  sessionId: string | undefined,
  pointer: CardDragPointer | null,
): void {
  if (!activeSession) return;
  if (sessionId && activeSession.id !== sessionId) return;
  activeSession.pointer = pointer;
}

export function endExternalCardDragSession(sessionId?: string): void {
  if (!activeSession) return;
  if (sessionId && activeSession.id !== sessionId) return;
  activeSession = null;
}
