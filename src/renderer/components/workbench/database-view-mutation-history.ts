import { useRef } from "react";

import type { DatabaseListMoveUndoRecipeV2 } from "../../../shared/database-module-v2";

const MAX_DATABASE_VIEW_UNDO_ACTIONS = 50;

export interface DatabaseViewMutationHistory {
  readonly setScope: (scopeKey: string) => void;
  readonly registerListMove: (recipe: DatabaseListMoveUndoRecipeV2) => void;
  readonly undoListMove: (
    undo: (recipe: DatabaseListMoveUndoRecipeV2) => Promise<boolean>,
  ) => Promise<boolean>;
  readonly size: () => number;
}

/** Bounded, session-only history. Core owns recipe interpretation and safety. */
export const createDatabaseViewMutationHistory = (
  initialScopeKey: string,
): DatabaseViewMutationHistory => {
  let scopeKey = initialScopeKey;
  let listMoves: DatabaseListMoveUndoRecipeV2[] = [];
  let undoing = false;
  return {
    setScope: (nextScopeKey) => {
      if (scopeKey === nextScopeKey) return;
      scopeKey = nextScopeKey;
      listMoves = [];
      undoing = false;
    },
    registerListMove: (recipe) => {
      listMoves = [...listMoves, recipe].slice(-MAX_DATABASE_VIEW_UNDO_ACTIONS);
    },
    undoListMove: async (undo) => {
      if (undoing) return false;
      const recipe = listMoves.at(-1);
      if (!recipe) return false;
      undoing = true;
      try {
        const undone = await undo(recipe);
        if (undone && listMoves.at(-1) === recipe) listMoves = listMoves.slice(0, -1);
        return undone;
      } finally {
        undoing = false;
      }
    },
    size: () => listMoves.length,
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
  void input.history.undoListMove(input.undoListMove);
  return true;
};
