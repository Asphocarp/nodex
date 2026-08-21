import type { BlockNoteEditor } from "@blocknote/core";
import type * as Y from "yjs";

import type {
  LibraryStructuralEditResult,
  LibraryStructuralHistoryToken,
} from "../../../../shared/library-module";

const HISTORY_ENTRY_META = Symbol("nodex-nfm-history-entry");
type YStackItem = Y.UndoManager["undoStack"][number];

interface StackItemEvent {
  readonly stackItem: YStackItem;
  readonly type: "undo" | "redo";
}

type NfmHistoryEntry =
  | {
      readonly kind: "yjs";
      readonly entryId: number;
      readonly stackItem: YStackItem;
    }
  | {
      readonly kind: "structural";
      readonly entryId: number;
      readonly token: LibraryStructuralHistoryToken;
    };

export interface NfmHistoryReverseResult {
  readonly structuralEdit: LibraryStructuralEditResult;
}

export interface NfmHistoryLaneOptions {
  readonly undoManager?: Y.UndoManager | null;
  readonly reverseStructural?: (
    token: LibraryStructuralHistoryToken,
  ) => Promise<NfmHistoryReverseResult>;
  readonly releaseStructural?: (tokens: readonly LibraryStructuralHistoryToken[]) => Promise<void>;
  readonly onStructuralReversed?: (result: LibraryStructuralEditResult) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

type NfmHistoryLaneHandlers = Omit<NfmHistoryLaneOptions, "undoManager">;

interface IndexedStructuralEntry {
  readonly lane: NfmHistoryLane;
  readonly entryId: number;
}

const structuralEntries = new Map<string, IndexedStructuralEntry>();

/**
 * Merges one editor surface's local Yjs stack with opaque Core structural
 * recipes. It never serializes or interprets either engine's inverse data.
 */
export class NfmHistoryLane {
  private readonly undoEntries: NfmHistoryEntry[] = [];
  private readonly redoEntries: NfmHistoryEntry[] = [];
  private nextEntryId = 1;
  private replaying = false;
  private pending = false;
  private disposed = false;
  private attachment = 0;
  private handlers: NfmHistoryLaneHandlers;
  private releaseStructural: NfmHistoryLaneHandlers["releaseStructural"];
  private onError: NfmHistoryLaneHandlers["onError"];

  private readonly handleStackItemAdded = (event: StackItemEvent): void => {
    if (this.disposed || this.replaying) return;
    if (event.type !== "undo") return;

    const existingEntryId = event.stackItem.meta.get(HISTORY_ENTRY_META);
    if (typeof existingEntryId === "number") return;

    const entryId = this.nextEntryId;
    this.nextEntryId += 1;
    event.stackItem.meta.set(HISTORY_ENTRY_META, entryId);
    this.undoEntries.push({ kind: "yjs", entryId, stackItem: event.stackItem });
    this.clearEntries(this.redoEntries);
  };

  constructor(private readonly options: NfmHistoryLaneOptions) {
    this.handlers = options;
    this.releaseStructural = options.releaseStructural;
    this.onError = options.onError;
    options.undoManager?.on("stack-item-added", this.handleStackItemAdded);
    for (const stackItem of options.undoManager?.undoStack ?? []) {
      this.handleStackItemAdded({ stackItem, type: "undo" });
    }
  }

  /** Rebinds view-owned callbacks while retaining the surface history itself. */
  attach(handlers: NfmHistoryLaneHandlers): () => void {
    if (this.disposed) return () => undefined;
    this.attachment += 1;
    const attachment = this.attachment;
    this.handlers = handlers;
    this.releaseStructural = handlers.releaseStructural ?? this.releaseStructural;
    this.onError = handlers.onError ?? this.onError;
    return () => {
      if (this.attachment !== attachment) return;
      this.handlers = {};
    };
  }

  recordStructural(result: LibraryStructuralEditResult): void {
    if (this.disposed || !result.history) return;
    this.options.undoManager?.stopCapturing();
    this.removeSuperseded(result.supersededHistoryRecipeOperationIds);
    const entry: NfmHistoryEntry = {
      kind: "structural",
      entryId: this.nextEntryId,
      token: result.history,
    };
    this.undoEntries.push(entry);
    this.indexStructural(entry);
    this.nextEntryId += 1;
    this.clearEntries(this.redoEntries);
  }

  canUndo(): boolean {
    return !this.disposed && this.undoEntries.length > 0;
  }

  canRedo(): boolean {
    return !this.disposed && this.redoEntries.length > 0;
  }

  requestUndo(): boolean {
    if (!this.canUndo() || this.pending) return false;
    void this.replay("undo").catch((error: unknown) => this.onError?.(error));
    return true;
  }

  requestRedo(): boolean {
    if (!this.canRedo() || this.pending) return false;
    void this.replay("redo").catch((error: unknown) => this.onError?.(error));
    return true;
  }

  stopCapturing(): void {
    this.options.undoManager?.stopCapturing();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.undoManager?.off("stack-item-added", this.handleStackItemAdded);
    this.clearEntries(this.undoEntries);
    this.clearEntries(this.redoEntries);
  }

  private async replay(direction: "undo" | "redo"): Promise<void> {
    const source = direction === "undo" ? this.undoEntries : this.redoEntries;
    const target = direction === "undo" ? this.redoEntries : this.undoEntries;
    const entry = source.at(-1);
    if (!entry) return;

    this.pending = true;
    this.replaying = true;
    try {
      if (entry.kind === "yjs") {
        const undoManager = this.options.undoManager;
        if (!undoManager) {
          throw new Error("The editor surface no longer has a local document history.");
        }
        const stack = direction === "undo" ? undoManager.undoStack : undoManager.redoStack;
        if (stack.at(-1) !== entry.stackItem) return;
        const replayed = direction === "undo" ? undoManager.undo() : undoManager.redo();
        if (!replayed) return;
        const inverseStack = direction === "undo" ? undoManager.redoStack : undoManager.undoStack;
        const inverseStackItem = inverseStack.at(-1);
        if (!inverseStackItem) return;
        inverseStackItem.meta.set(HISTORY_ENTRY_META, entry.entryId);
        source.pop();
        target.push({ ...entry, stackItem: inverseStackItem });
        return;
      }

      this.options.undoManager?.stopCapturing();
      const reverseStructural = this.handlers.reverseStructural;
      if (!reverseStructural) {
        throw new Error("The editor surface is not mounted for structural history replay.");
      }
      const replayed = await reverseStructural(entry.token);
      const replacement = replayed.structuralEdit.history;
      if (!replacement) {
        throw new Error("Core structural history replay omitted its inverse token.");
      }
      this.unindexStructural(entry);
      source.pop();
      const inverseEntry = { ...entry, token: replacement };
      target.push(inverseEntry);
      this.indexStructural(inverseEntry);
      this.removeSuperseded(
        replayed.structuralEdit.supersededHistoryRecipeOperationIds,
        entry.entryId,
      );
      await this.handlers.onStructuralReversed?.(replayed.structuralEdit);
    } finally {
      this.replaying = false;
      this.pending = false;
    }
  }

  private removeSuperseded(recipeOperationIds: readonly string[], exceptEntryId?: number): void {
    for (const recipeOperationId of recipeOperationIds) {
      const indexed = structuralEntries.get(recipeOperationId);
      if (!indexed || indexed.entryId === exceptEntryId) continue;
      indexed.lane.removeStructuralEntry(indexed.entryId);
    }
  }

  private clearEntries(entries: NfmHistoryEntry[]): void {
    const tokens = entries.flatMap((entry) => (entry.kind === "structural" ? [entry.token] : []));
    for (const entry of entries) {
      if (entry.kind === "structural") this.unindexStructural(entry);
    }
    entries.length = 0;
    if (tokens.length === 0 || !this.releaseStructural) return;
    void this.releaseStructural(tokens).catch((error: unknown) => {
      this.onError?.(error);
    });
  }

  private indexStructural(entry: Extract<NfmHistoryEntry, { kind: "structural" }>): void {
    structuralEntries.set(entry.token.recipeOperationId, {
      lane: this,
      entryId: entry.entryId,
    });
  }

  private unindexStructural(entry: Extract<NfmHistoryEntry, { kind: "structural" }>): void {
    const key = entry.token.recipeOperationId;
    const indexed = structuralEntries.get(key);
    if (indexed?.lane === this && indexed.entryId === entry.entryId) {
      structuralEntries.delete(key);
    }
  }

  private removeStructuralEntry(entryId: number): void {
    for (const entries of [this.undoEntries, this.redoEntries]) {
      const index = entries.findIndex(
        (entry) => entry.kind === "structural" && entry.entryId === entryId,
      );
      if (index < 0) continue;
      const [entry] = entries.splice(index, 1);
      if (entry?.kind === "structural") this.unindexStructural(entry);
      return;
    }
  }
}

export function resolveNfmUndoManager(
  editor: BlockNoteEditor<any, any, any>,
): Y.UndoManager | null {
  const plugin = editor.prosemirrorState.plugins.find((candidate) =>
    (candidate as unknown as { readonly key: string }).key.startsWith("y-undo$"),
  );
  const state = plugin?.getState(editor.prosemirrorState) as
    | { readonly undoManager?: Y.UndoManager }
    | undefined;
  return state?.undoManager ?? null;
}
