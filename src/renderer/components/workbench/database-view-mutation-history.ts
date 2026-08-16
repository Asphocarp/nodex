import { useRef } from "react";

import type { DatabaseListMoveUndoRecipeV2 } from "../../../shared/database-module-v2";
import type { BlockTransferUndoToken } from "../../../shared/block-transfer";

const MAX_DATABASE_VIEW_UNDO_ACTIONS = 50;

export interface DatabaseViewMutationHistory {
  readonly setScope: (scopeKey: string) => void;
  readonly registerListMove: (recipe: DatabaseListMoveUndoRecipeV2) => void;
  readonly undoListMove: (
    undo: (recipe: DatabaseListMoveUndoRecipeV2) => Promise<boolean>,
  ) => Promise<boolean>;
  readonly registerBlockTransfer: (token: BlockTransferUndoToken) => void;
  readonly undoLast: (handlers: DatabaseViewMutationUndoHandlers) => Promise<boolean>;
  readonly size: () => number;
}

export type DatabaseViewMutationHistoryEntry =
  | { readonly kind: "list_move"; readonly recipe: DatabaseListMoveUndoRecipeV2 }
  | { readonly kind: "block_transfer"; readonly token: BlockTransferUndoToken };

export interface DatabaseViewMutationUndoHandlers {
  readonly listMove: (recipe: DatabaseListMoveUndoRecipeV2) => Promise<boolean>;
  readonly blockTransfer: (token: BlockTransferUndoToken) => Promise<boolean>;
}

/** Bounded, session-only history. Core owns recipe interpretation and safety. */
export const createDatabaseViewMutationHistory = (
  initialScopeKey: string,
): DatabaseViewMutationHistory => {
  let scopeKey = initialScopeKey;
  let entries: DatabaseViewMutationHistoryEntry[] = [];
  let undoing = false;
  return {
    setScope: (nextScopeKey) => {
      if (scopeKey === nextScopeKey) return;
      scopeKey = nextScopeKey;
      entries = [];
      undoing = false;
    },
    registerListMove: (recipe) => {
      entries = [...entries, { kind: "list_move" as const, recipe }]
        .slice(-MAX_DATABASE_VIEW_UNDO_ACTIONS);
    },
    undoListMove: async (undo) => {
      if (undoing) return false;
      const entry = entries.at(-1);
      if (!entry || entry.kind !== "list_move") return false;
      undoing = true;
      try {
        const undone = await undo(entry.recipe);
        if (undone && entries.at(-1) === entry) entries = entries.slice(0, -1);
        return undone;
      } finally {
        undoing = false;
      }
    },
    registerBlockTransfer: (token) => {
      entries = [...entries, { kind: "block_transfer" as const, token }]
        .slice(-MAX_DATABASE_VIEW_UNDO_ACTIONS);
    },
    undoLast: async (handlers) => {
      if (undoing) return false;
      const entry = entries.at(-1);
      if (!entry) return false;
      undoing = true;
      try {
        const undone = entry.kind === "list_move"
          ? await handlers.listMove(entry.recipe)
          : await handlers.blockTransfer(entry.token);
        if (undone && entries.at(-1) === entry) entries = entries.slice(0, -1);
        return undone;
      } finally {
        undoing = false;
      }
    },
    size: () => entries.length,
  };
};

export const useDatabaseViewMutationHistory = (scopeKey: string): DatabaseViewMutationHistory => {
  const historyRef = useRef<DatabaseViewMutationHistory | null>(null);
  historyRef.current ??= createDatabaseViewMutationHistory(scopeKey);
  historyRef.current.setScope(scopeKey);
  return historyRef.current;
};

interface UndoKeyboardEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

const ownsLocalUndo = (target: EventTarget | null): boolean => {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return Boolean(target.closest([
    "input",
    "textarea",
    "[contenteditable=true]",
    "[role=textbox]",
    "[role=combobox]",
    "[role=menu]",
  ].join(",")));
};

export const handleDatabaseViewMutationHistoryKeyDown = (input: {
  readonly event: UndoKeyboardEvent;
  readonly history: DatabaseViewMutationHistory;
  readonly undoListMove: (
    recipe: DatabaseListMoveUndoRecipeV2,
  ) => Promise<boolean>;
  readonly undoBlockTransfer?: (
    token: BlockTransferUndoToken,
  ) => Promise<boolean>;
}): boolean => {
  const { event } = input;
  if (
    event.key.toLowerCase() !== "z"
    || (!event.metaKey && !event.ctrlKey)
    || event.shiftKey
    || ownsLocalUndo(event.target)
    || input.history.size() === 0
  ) return false;
  event.preventDefault();
  event.stopPropagation();
  void input.history.undoLast({
    listMove: input.undoListMove,
    blockTransfer: input.undoBlockTransfer ?? (async () => false),
  });
  return true;
};
