import { MAX_CARD_WRITE_BODY_BYTES } from "../shared/card-limits";
import {
  CROSS_WINDOW_DRAG_TOKEN_VERSION,
  type CrossWindowDragClaimInput,
  type CrossWindowDragClaimResult,
  type CrossWindowDragCompleteInput,
  type CrossWindowDragPreview,
  type CrossWindowDragSourceResult,
  type CrossWindowDragStartInput,
} from "../shared/cross-window-drag";
import { assertValidCardInput } from "./local-store/card-input-validation";

const ACTIVE_TTL_MS = 120_000;
const SOURCE_END_GRACE_MS = 1_000;
const CLAIM_TTL_MS = 15_000;

interface TimerApi {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

interface CrossWindowDragCoordinatorOptions {
  timers?: TimerApi;
  onActiveChanged: (preview: CrossWindowDragPreview | null) => void;
  onSourceResult: (sourceWebContentsId: number, result: CrossWindowDragSourceResult) => void;
}

interface DragSessionRecord {
  input: CrossWindowDragStartInput;
  sourceWebContentsId: number;
  claimantWebContentsId: number | null;
  activeTimer: ReturnType<typeof setTimeout>;
  sourceEndTimer: ReturnType<typeof setTimeout> | null;
  claimTimer: ReturnType<typeof setTimeout> | null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getPayloadBytes(input: CrossWindowDragStartInput): number {
  return Buffer.byteLength(JSON.stringify(input), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateStartInput(input: CrossWindowDragStartInput): void {
  if (!input || input.version !== CROSS_WINDOW_DRAG_TOKEN_VERSION) {
    throw new Error("Unsupported cross-window drag payload version");
  }
  if (!isUuid(input.sessionId)) {
    throw new Error("Invalid cross-window drag session id");
  }
  if (getPayloadBytes(input) > MAX_CARD_WRITE_BODY_BYTES) {
    throw new Error("Cross-window drag payload is too large");
  }

  if (input.kind === "blocks") {
    if (!Array.isArray(input.payload.cards) || input.payload.cards.length === 0) {
      throw new Error("Block drag must include at least one card");
    }
    if (!Array.isArray(input.payload.sourceUpdates)) {
      throw new Error("Block drag source updates must be an array");
    }
    if (!isUuid(input.payload.groupId)) {
      throw new Error("Invalid block drag group id");
    }
    input.payload.cards.forEach((card) => assertValidCardInput(card, "create"));
    input.payload.sourceUpdates.forEach((update) => {
      if (!isRecord(update)) throw new Error("Invalid block drag source update");
      if (typeof update.projectId !== "string" || update.projectId.length === 0) {
        throw new Error("Block drag source project id is required");
      }
      if (typeof update.cardId !== "string" || update.cardId.length === 0) {
        throw new Error("Block drag source card id is required");
      }
      if (!isRecord(update.updates)) {
        throw new Error("Invalid block drag source card update");
      }
      assertValidCardInput(update.updates, "update");
    });
    return;
  }

  if (!isUuid(input.groupId)) {
    throw new Error("Invalid card drag group id");
  }
  if (typeof input.payload.projectId !== "string" || input.payload.projectId.length === 0) {
    throw new Error("Card drag project id is required");
  }
  if (!Array.isArray(input.payload.cards) || input.payload.cards.length === 0) {
    throw new Error("Card drag must include at least one card");
  }
  const seenCardIds = new Set<string>();
  input.payload.cards.forEach((entry) => {
    if (!isRecord(entry) || !isRecord(entry.card)) {
      throw new Error("Invalid card drag item");
    }
    if (typeof entry.card.id !== "string" || entry.card.id.length === 0) {
      throw new Error("Card drag item id is required");
    }
    if (seenCardIds.has(entry.card.id)) {
      throw new Error("Card drag item ids must be unique");
    }
    if (typeof entry.card.title !== "string" || entry.card.title.length === 0) {
      throw new Error("Card drag item title is required");
    }
    if (typeof entry.columnId !== "string" || entry.columnId.length === 0) {
      throw new Error("Card drag source column is required");
    }
    seenCardIds.add(entry.card.id);
  });
}

function toPreview(input: CrossWindowDragStartInput): CrossWindowDragPreview {
  if (input.kind === "blocks") {
    return {
      version: CROSS_WINDOW_DRAG_TOKEN_VERSION,
      sessionId: input.sessionId,
      kind: "blocks",
      cards: input.payload.cards,
    };
  }

  return {
    version: CROSS_WINDOW_DRAG_TOKEN_VERSION,
    sessionId: input.sessionId,
    kind: "cards",
    payload: input.payload,
  };
}

export class CrossWindowDragCoordinator {
  private readonly sessions = new Map<string, DragSessionRecord>();
  private readonly timers: TimerApi;
  private activeSessionId: string | null = null;

  constructor(private readonly options: CrossWindowDragCoordinatorOptions) {
    this.timers = options.timers ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timer) => clearTimeout(timer),
    };
  }

  start(sourceWebContentsId: number, input: CrossWindowDragStartInput): boolean {
    const storedInput = structuredClone(input);
    validateStartInput(storedInput);

    if (this.activeSessionId) {
      const previous = this.sessions.get(this.activeSessionId);
      if (previous && previous.claimantWebContentsId === null) {
        this.finish(previous, "cancel");
      }
    }

    const existing = this.sessions.get(storedInput.sessionId);
    if (existing) {
      this.finish(existing, "cancel");
    }

    const activeTimer = this.timers.setTimeout(() => {
      const session = this.sessions.get(storedInput.sessionId);
      if (session) this.finish(session, "cancel");
    }, ACTIVE_TTL_MS);
    const record: DragSessionRecord = {
      input: storedInput,
      sourceWebContentsId,
      claimantWebContentsId: null,
      activeTimer,
      sourceEndTimer: null,
      claimTimer: null,
    };
    this.sessions.set(storedInput.sessionId, record);
    this.activeSessionId = storedInput.sessionId;
    this.options.onActiveChanged(toPreview(storedInput));
    return true;
  }

  getActive(): CrossWindowDragPreview | null {
    if (!this.activeSessionId) return null;
    const record = this.sessions.get(this.activeSessionId);
    if (!record) return null;
    return toPreview(record.input);
  }

  claim(targetWebContentsId: number, input: CrossWindowDragClaimInput): CrossWindowDragClaimResult {
    if (!input || typeof input.sessionId !== "string") {
      throw new Error("Invalid cross-window drag claim");
    }
    if (input.kind !== "blocks" && input.kind !== "cards") {
      throw new Error("Invalid cross-window drag kind");
    }
    const record = this.requireSession(input.sessionId);
    if (record.input.kind !== input.kind) {
      throw new Error("Cross-window drag kind mismatch");
    }
    if (record.sourceWebContentsId === targetWebContentsId) {
      throw new Error("Cross-window drag must be claimed by another window");
    }
    if (record.claimantWebContentsId !== null) {
      throw new Error("Cross-window drag has already been claimed");
    }

    record.claimantWebContentsId = targetWebContentsId;
    if (record.sourceEndTimer) {
      this.timers.clearTimeout(record.sourceEndTimer);
      record.sourceEndTimer = null;
    }
    this.clearActive(record.input.sessionId);
    record.claimTimer = this.timers.setTimeout(() => {
      const current = this.sessions.get(record.input.sessionId);
      if (current) this.finish(current, "cancel");
    }, CLAIM_TTL_MS);

    if (record.input.kind === "blocks") {
      return { kind: "blocks", payload: record.input.payload };
    }
    return {
      kind: "cards",
      payload: record.input.payload,
      groupId: record.input.groupId,
    };
  }

  sourceEnded(sourceWebContentsId: number, sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.sourceWebContentsId !== sourceWebContentsId) return false;

    this.clearActive(sessionId);
    if (record.claimantWebContentsId !== null || record.sourceEndTimer) return true;
    record.sourceEndTimer = this.timers.setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (current && current.claimantWebContentsId === null) {
        this.finish(current, "cancel");
      }
    }, SOURCE_END_GRACE_MS);
    return true;
  }

  complete(targetWebContentsId: number, input: CrossWindowDragCompleteInput): boolean {
    if (!input || typeof input.sessionId !== "string") return false;
    if (input.result !== "move" && input.result !== "copy" && input.result !== "cancel") {
      return false;
    }
    const record = this.sessions.get(input.sessionId);
    if (!record || record.claimantWebContentsId !== targetWebContentsId) return false;
    this.finish(record, input.result);
    return true;
  }

  discard(sourceWebContentsId: number, sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.sourceWebContentsId !== sourceWebContentsId) return false;
    if (record.claimantWebContentsId !== null) return false;
    this.deleteSession(record);
    return true;
  }

  handleWebContentsDestroyed(webContentsId: number): void {
    for (const record of [...this.sessions.values()]) {
      if (record.sourceWebContentsId === webContentsId) {
        this.deleteSession(record);
        continue;
      }
      if (record.claimantWebContentsId === webContentsId) {
        this.finish(record, "cancel");
      }
    }
  }

  private requireSession(sessionId: string): DragSessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error("Cross-window drag session is unavailable or expired");
    return record;
  }

  private clearActive(sessionId: string): void {
    if (this.activeSessionId !== sessionId) return;
    this.activeSessionId = null;
    this.options.onActiveChanged(null);
  }

  private finish(
    record: DragSessionRecord,
    result: CrossWindowDragSourceResult["result"],
  ): void {
    this.options.onSourceResult(record.sourceWebContentsId, {
      sessionId: record.input.sessionId,
      result,
    });
    this.deleteSession(record);
  }

  private deleteSession(record: DragSessionRecord): void {
    this.clearActive(record.input.sessionId);
    this.timers.clearTimeout(record.activeTimer);
    if (record.sourceEndTimer) this.timers.clearTimeout(record.sourceEndTimer);
    if (record.claimTimer) this.timers.clearTimeout(record.claimTimer);
    this.sessions.delete(record.input.sessionId);
  }
}
