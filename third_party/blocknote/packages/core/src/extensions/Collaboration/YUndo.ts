import { Plugin } from "prosemirror-state";
import {
  defaultDeleteFilter,
  defaultProtectedNodes,
  getRelativeSelection,
  redoCommand,
  undoCommand,
  ySyncPluginKey,
  yUndoPluginKey,
} from "y-prosemirror";
import * as Y from "yjs";
import { createExtension } from "../../editor/BlockNoteExtension.js";

type RelativeSelection = ReturnType<typeof getRelativeSelection>;

interface SurfaceUndoPluginState {
  readonly undoManager: Y.UndoManager;
  readonly prevSel: RelativeSelection | null;
  readonly hasUndoOps: boolean;
  readonly hasRedoOps: boolean;
}

interface YSyncPluginState {
  readonly type: Y.AbstractType<unknown>;
  readonly binding?: Parameters<typeof getRelativeSelection>[0];
}

interface UndoStackItemEvent {
  readonly stackItem: {
    readonly meta: Map<unknown, unknown>;
  };
}

function createSurfaceUndoController() {
  let manager: Y.UndoManager | null = null;
  let disposed = false;

  return {
    get(type: Y.AbstractType<unknown>): Y.UndoManager {
      if (disposed) {
        throw new Error("Cannot use a disposed collaborative undo extension");
      }
      if (manager) return manager;

      manager = new Y.UndoManager(type, {
        trackedOrigins: new Set([ySyncPluginKey]),
        deleteFilter: (item) =>
          defaultDeleteFilter(item, defaultProtectedNodes),
        captureTransaction: (transaction) =>
          transaction.meta.get("addToHistory") !== false,
      });
      return manager;
    },
    destroy(): void {
      if (disposed) return;
      disposed = true;
      manager?.destroy();
      manager = null;
    },
  };
}

function createSurfaceYUndoPlugin(
  controller: ReturnType<typeof createSurfaceUndoController>,
): Plugin<SurfaceUndoPluginState> {
  return new Plugin<SurfaceUndoPluginState>({
    key: yUndoPluginKey,
    state: {
      init: (_config, state) => {
        const syncState = ySyncPluginKey.getState(state) as
          | YSyncPluginState
          | undefined;
        if (!syncState) {
          throw new Error("Collaborative undo requires the Yjs sync plugin");
        }

        return {
          get undoManager() {
            return controller.get(syncState.type);
          },
          prevSel: null,
          hasUndoOps: false,
          hasRedoOps: false,
        };
      },
      apply: (_transaction, value, oldState, state) => {
        const syncState = ySyncPluginKey.getState(state) as
          | YSyncPluginState
          | undefined;
        const manager = value.undoManager;
        const hasUndoOps = manager.undoStack.length > 0;
        const hasRedoOps = manager.redoStack.length > 0;

        if (!syncState?.binding) {
          if (
            hasUndoOps === value.hasUndoOps &&
            hasRedoOps === value.hasRedoOps
          ) {
            return value;
          }
          return { ...value, hasUndoOps, hasRedoOps };
        }

        return {
          undoManager: manager,
          prevSel: getRelativeSelection(syncState.binding, oldState),
          hasUndoOps,
          hasRedoOps,
        };
      },
    },
    view: (view) => {
      const syncState = ySyncPluginKey.getState(view.state) as
        | YSyncPluginState
        | undefined;
      const undoState = yUndoPluginKey.getState(view.state) as
        | SurfaceUndoPluginState
        | undefined;
      if (!syncState || !undoState) {
        throw new Error("Collaborative undo plugins are not initialized");
      }

      const manager = undoState.undoManager;
      const handleStackItemAdded = ({
        stackItem,
      }: UndoStackItemEvent): void => {
        const binding = syncState.binding;
        if (!binding) return;
        const current = yUndoPluginKey.getState(view.state) as
          | SurfaceUndoPluginState
          | undefined;
        stackItem.meta.set(binding, current?.prevSel ?? null);
      };
      const handleStackItemPopped = ({
        stackItem,
      }: UndoStackItemEvent): void => {
        const binding = syncState.binding;
        if (!binding) return;
        binding.beforeTransactionSelection =
          (stackItem.meta.get(binding) as RelativeSelection | undefined) ??
          binding.beforeTransactionSelection;
      };

      manager.on("stack-item-added", handleStackItemAdded);
      manager.on("stack-item-popped", handleStackItemPopped);

      return {
        destroy: () => {
          manager.off("stack-item-added", handleStackItemAdded);
          manager.off("stack-item-popped", handleStackItemPopped);
        },
      };
    },
  });
}

export const YUndoExtension = createExtension(() => {
  const controller = createSurfaceUndoController();
  return {
    key: "yUndo",
    prosemirrorPlugins: [createSurfaceYUndoPlugin(controller)],
    dependsOn: ["yCursor", "ySync"],
    undoCommand: undoCommand,
    redoCommand: redoCommand,
    destroy: controller.destroy,
  } as const;
});
