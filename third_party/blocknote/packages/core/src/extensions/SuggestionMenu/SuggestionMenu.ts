import { findParentNode } from "@tiptap/core";
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";

import { trackPosition } from "../../api/positionMapping.js";
import { BlockNoteEditor } from "../../editor/BlockNoteEditor.js";
import {
  createExtension,
  createStore,
} from "../../editor/BlockNoteExtension.js";
import { UiElementPosition } from "../../extensions-shared/UiElementPosition.js";

const findBlock = findParentNode((node) => node.type.name === "blockContainer");

function normalizeDOMRect(rect: DOMRect): DOMRect {
  return typeof rect.toJSON === "function" ? (rect.toJSON() as DOMRect) : rect;
}

export type SuggestionMenuState = UiElementPosition & {
  query: string;
  ignoreQueryLength?: boolean;
  isComposing?: boolean;
};

export type SuggestionMenuRuntimeState = {
  triggerCharacter: string;
  query: string;
  show: boolean;
  isComposing: boolean;
};

export type SuggestionMenuCloseReason =
  | "escape"
  | "outside"
  | "accepted"
  | "backspace-before-trigger"
  | "selection-expanded"
  | "cross-block"
  | "blur"
  | "pointer"
  | "code-block"
  | "invalid-query"
  | "controller-unmounted"
  | "programmatic";

class SuggestionMenuView {
  public state?: SuggestionMenuState;
  public lastCloseReason?: SuggestionMenuCloseReason;
  public emitUpdate: (triggerCharacter: string) => void;
  private rootEl?: Document | ShadowRoot;
  private compositionEl?: HTMLElement;
  private compositionEndTimer?: ReturnType<typeof setTimeout>;
  private isComposing = false;
  pluginState?: ActiveSuggestionPluginState;

  constructor(
    private readonly editor: BlockNoteEditor<any, any, any>,
    emitUpdate: (menuName: string, state: SuggestionMenuState) => void,
    view: EditorView,
    private readonly clearState: () => void,
  ) {
    this.emitUpdate = (menuName: string) => {
      if (!this.state) return;

      emitUpdate(menuName, {
        ...this.state,
        ignoreQueryLength: this.pluginState?.ignoreQueryLength,
        isComposing: this.isComposing,
      });
    };

    this.rootEl = view.root;
    this.compositionEl = view.dom;

    // Setting capture=true ensures that any parent container of the editor that
    // gets scrolled will trigger the scroll event. Scroll events do not bubble
    // and so won't propagate to the document by default.
    this.rootEl?.addEventListener("scroll", this.handleScroll, true);
    this.compositionEl.addEventListener("compositionstart", this.handleCompositionStart, true);
    this.compositionEl.addEventListener("compositionend", this.handleCompositionEnd, true);
  }

  handleCompositionStart = () => {
    if (this.compositionEndTimer) clearTimeout(this.compositionEndTimer);
    this.isComposing = true;
    if (this.state) this.state.isComposing = true;
    if (this.state?.show) this.emitUpdate(this.pluginState!.triggerCharacter!);
  };

  handleCompositionEnd = () => {
    if (this.compositionEndTimer) clearTimeout(this.compositionEndTimer);
    this.compositionEndTimer = setTimeout(() => {
      this.compositionEndTimer = undefined;
      this.isComposing = false;
      if (this.state) this.state.isComposing = false;
      if (this.state?.show) this.emitUpdate(this.pluginState!.triggerCharacter!);
    }, 0);
  };

  handleScroll = () => {
    if (this.state?.show) {
      const decorationNode = this.rootEl?.querySelector(
        `[data-decoration-id="${this.pluginState!.decorationId}"]`,
      );
      if (!decorationNode) {
        return;
      }
      this.state.referencePos = normalizeDOMRect(decorationNode.getBoundingClientRect());
      this.emitUpdate(this.pluginState!.triggerCharacter!);
    }
  };

  update(view: EditorView, prevState: EditorState) {
    const prev = suggestionMenuPluginKey.getState(prevState)!;
    const next = suggestionMenuPluginKey.getState(view.state)!;
    const prevSession = getActiveSuggestionSession(prev);
    const nextSession = getActiveSuggestionSession(next);

    // See how the state changed
    const started = prevSession === undefined && nextSession !== undefined;
    const stopped = prevSession !== undefined && nextSession === undefined;
    const changed = prevSession !== undefined && nextSession !== undefined;

    // Cancel when suggestion isn't active
    if (!started && !changed && !stopped) {
      return;
    }

    this.pluginState = stopped ? prevSession : nextSession;

    if (stopped || !this.editor.isEditable) {
      if (stopped) this.lastCloseReason = next.lastCloseReason;
      if (this.state) {
        this.state.show = false;
      }
      this.emitUpdate(this.pluginState!.triggerCharacter);

      return;
    }

    const decorationNode = this.rootEl?.querySelector(
      `[data-decoration-id="${this.pluginState!.decorationId}"]`,
    );

    if (this.editor.isEditable && decorationNode) {
      this.state = {
        show: true,
        referencePos: normalizeDOMRect(decorationNode.getBoundingClientRect()),
        query: this.pluginState!.query,
        isComposing: this.isComposing,
      };

      this.emitUpdate(this.pluginState!.triggerCharacter!);
    }
  }

  destroy() {
    if (this.compositionEndTimer) clearTimeout(this.compositionEndTimer);
    this.rootEl?.removeEventListener("scroll", this.handleScroll, true);
    this.compositionEl?.removeEventListener(
      "compositionstart",
      this.handleCompositionStart,
      true,
    );
    this.compositionEl?.removeEventListener(
      "compositionend",
      this.handleCompositionEnd,
      true,
    );
    this.state = undefined;
    this.pluginState = undefined;
    this.clearState();
  }

  closeMenu = (reason: SuggestionMenuCloseReason = "programmatic") => {
    if (!getActiveSuggestionSession(suggestionMenuPluginKey.getState(this.editor.prosemirrorState))) {
      return false;
    }

    this.editor.transact((tr) =>
      tr.setMeta(suggestionMenuPluginKey, { type: "close", reason }),
    );
    return true;
  };

  acceptMenu = () => {
    const session = getActiveSuggestionSession(
      suggestionMenuPluginKey.getState(this.editor.prosemirrorState),
    );
    if (!session) return false;
    const queryStart = session.queryStartPos();
    const from =
      queryStart -
      (session.deleteTriggerCharacter ? session.triggerCharacter.length : 0);

    return this.editor.transact((transaction) => {
      const to = transaction.selection.from;
      if (from > to) return false;

      transaction
        .delete(from, to)
        .setMeta(suggestionMenuPluginKey, { type: "close", reason: "accepted" })
        .scrollIntoView();
      return true;
    });
  };
}

type ActiveSuggestionPluginState = {
  readonly status: "active";
  triggerCharacter: string;
  deleteTriggerCharacter: boolean;
  queryStartPos: () => number;
  query: string;
  decorationId: string;
  ignoreQueryLength?: boolean;
};

type SuggestionPluginState =
  | ActiveSuggestionPluginState
  | {
      readonly status: "inactive";
      readonly lastCloseReason?: SuggestionMenuCloseReason;
    };

type SuggestionMenuTransactionMeta =
  | {
      readonly type: "open";
      readonly triggerCharacter: string;
      readonly deleteTriggerCharacter?: boolean;
      readonly ignoreQueryLength?: boolean;
    }
  | {
      readonly type: "close";
      readonly reason: SuggestionMenuCloseReason;
    };

function getActiveSuggestionSession(
  state: SuggestionPluginState | undefined,
): ActiveSuggestionPluginState | undefined {
  return state?.status === "active" ? state : undefined;
}

export type SuggestionMenuOptions = {
  triggerCharacter: string;
  /**
   * Optional callback to determine whether the suggestion menu should be
   * opened in the current editor state. Return `false` to prevent the
   * menu from opening (e.g. when the cursor is inside table content).
   */
  shouldOpen?: (tr: Transaction) => boolean;
};

type RegisteredSuggestionMenu = {
  readonly options: SuggestionMenuOptions;
};

const suggestionMenuPluginKey = new PluginKey<SuggestionPluginState>(
  "SuggestionMenuPlugin",
);

/**
 * A ProseMirror plugin for suggestions, designed to make '/'-commands possible as well as mentions.
 *
 * This is basically a simplified version of TipTap's [Suggestions](https://github.com/ueberdosis/tiptap/tree/db92a9b313c5993b723c85cd30256f1d4a0b65e1/packages/suggestion) plugin.
 *
 * This version is adapted from the aforementioned version in the following ways:
 * - This version supports generic items instead of only strings (to allow for more advanced filtering for example)
 * - This version hides some unnecessary complexity from the user of the plugin.
 * - This version handles key events differently
 */
export const SuggestionMenu = createExtension(({ editor }) => {
  const suggestionMenus = new Map<string, RegisteredSuggestionMenu>();
  let view: SuggestionMenuView | undefined = undefined;
  const getCurrentSession = () =>
    getActiveSuggestionSession(suggestionMenuPluginKey.getState(editor.prosemirrorState));
  const store = createStore<
    (SuggestionMenuState & { triggerCharacter: string }) | undefined
  >(undefined);
  return {
    key: "suggestionMenu",
    store,
    addSuggestionMenu: (options: SuggestionMenuOptions) => {
      const registration = { options } satisfies RegisteredSuggestionMenu;
      suggestionMenus.set(options.triggerCharacter, registration);
      return () => {
        if (suggestionMenus.get(options.triggerCharacter) !== registration) return;
        suggestionMenus.delete(options.triggerCharacter);
        if (getCurrentSession()?.triggerCharacter === options.triggerCharacter) {
          view?.closeMenu("controller-unmounted");
        }
      };
    },
    removeSuggestionMenu: (triggerCharacter: string) => {
      if (!suggestionMenus.delete(triggerCharacter)) return;
      if (getCurrentSession()?.triggerCharacter === triggerCharacter) {
        view?.closeMenu("controller-unmounted");
      }
    },
    closeMenu: (reason: SuggestionMenuCloseReason = "programmatic") => {
      view?.closeMenu(reason);
    },
    /** Consumes the tracked query and closes its session as one accepted action. */
    acceptMenu: () => view?.acceptMenu() ?? false,
    getMenuState: (): SuggestionMenuRuntimeState | undefined => {
      const session = getCurrentSession();
      if (!view?.state || !session) return undefined;

      return {
        triggerCharacter: session.triggerCharacter,
        query: session.query,
        show: Boolean(view.state.show),
        isComposing: view.state.isComposing ?? false,
      };
    },
    getLastCloseReason: () => view?.lastCloseReason,
    shown: () => {
      return Boolean(getCurrentSession() && view?.state?.show);
    },
    openSuggestionMenu: (
      triggerCharacter: string,
      pluginState?: {
        deleteTriggerCharacter?: boolean;
        ignoreQueryLength?: boolean;
        ensureLeadingSpace?: boolean;
      },
    ) => {
      if (editor.headless) {
        return;
      }
      if (editor._tiptapEditor.state.selection.$from.parent.type.spec.code) return;

      editor.focus();

      editor.transact((tr) => {
        if (pluginState?.ensureLeadingSpace && tr.selection.empty) {
          const { parent, parentOffset } = tr.selection.$from;
          const textBefore = parent.textBetween(0, parentOffset, undefined, "\ufffc");
          const previousCharacter = Array.from(textBefore).at(-1);
          if (previousCharacter && !/\s/u.test(previousCharacter)) tr.insertText(" ");
        }
        if (pluginState?.deleteTriggerCharacter) {
          tr.insertText(triggerCharacter);
        }
        tr.scrollIntoView().setMeta(suggestionMenuPluginKey, {
          type: "open",
          triggerCharacter: triggerCharacter,
          deleteTriggerCharacter: pluginState?.deleteTriggerCharacter || false,
          ignoreQueryLength: pluginState?.ignoreQueryLength || false,
        });
      });
    },
    // TODO this whole plugin needs to be refactored (but I've done the minimal)
    prosemirrorPlugins: [
      new Plugin({
        key: suggestionMenuPluginKey,

        view: (v) => {
          view = new SuggestionMenuView(
            editor,
            (triggerCharacter, state) => {
              store.setState({ ...state, triggerCharacter });
            },
            v,
            () => {
              view = undefined;
              store.setState(undefined);
            },
          );
          return view;
        },

        state: {
          // Initialize the plugin's internal state.
          init(): SuggestionPluginState {
            return { status: "inactive" };
          },

          // Apply changes to the plugin state from an editor transaction.
          apply: (
            transaction,
            prev,
            _oldState,
            newState,
          ): SuggestionPluginState => {
            const closeSession = (reason: SuggestionMenuCloseReason): SuggestionPluginState => ({
              status: "inactive",
              lastCloseReason: reason,
            });
            const transactionMeta = transaction.getMeta(suggestionMenuPluginKey) as
              | SuggestionMenuTransactionMeta
              | undefined;
            const activeSession = getActiveSuggestionSession(prev);

            // Code blocks own text-entry shortcuts and never host suggestions.
            if (transaction.selection.$from.parent.type.spec.code) {
              return activeSession ? closeSession("code-block") : prev;
            }

            if (transactionMeta?.type === "open") {
              const trackedPosition = trackPosition(
                editor,
                newState.selection.from -
                  // Need to account for the trigger char that was inserted, so we offset the position by the length of the trigger character.
                  transactionMeta.triggerCharacter.length,
              );
              return {
                status: "active",
                triggerCharacter: transactionMeta.triggerCharacter,
                deleteTriggerCharacter: transactionMeta.deleteTriggerCharacter !== false,
                // When reading the queryStartPos, we offset the result by the length of the trigger character, to make it easy on the caller
                queryStartPos: () =>
                  trackedPosition() + transactionMeta.triggerCharacter.length,
                query: "",
                decorationId: `id_${Math.floor(Math.random() * 0xffffffff)}`,
                ignoreQueryLength: transactionMeta.ignoreQueryLength,
              };
            }

            // Checks if the menu is hidden, in which case it doesn't need to be hidden or updated.
            if (!activeSession) return prev;

            if (!newState.selection.empty) return closeSession("selection-expanded");
            if (transactionMeta?.type === "close") return closeSession(transactionMeta.reason);
            if (transaction.getMeta("focus")) return closeSession("outside");
            if (transaction.getMeta("blur")) return closeSession("blur");
            if (transaction.getMeta("pointer")) return closeSession("pointer");
            if (newState.selection.from < activeSession.queryStartPos()) {
              return closeSession("backspace-before-trigger");
            }
            if (
              !newState.selection.$from.sameParent(
                newState.doc.resolve(activeSession.queryStartPos()),
              )
            ) {
              return closeSession("cross-block");
            }

            const next = { ...activeSession };

            // Updates the current query.
            next.query = newState.doc.textBetween(
              activeSession.queryStartPos(),
              newState.selection.from,
            );

            return next;
          },
        },

        props: {
          handleTextInput(view, from, to, text) {
            // only on insert
            if (from === to) {
              // Trigger characters typed inside a live query remain query text.
              if (getActiveSuggestionSession(suggestionMenuPluginKey.getState(view.state))) {
                return false;
              }
              const doc = view.state.doc;
              for (const [triggerChar, registration] of suggestionMenus) {
                const { options: menuOptions } = registration;
                const snippet =
                  triggerChar.length > 1
                    ? doc.textBetween(from - (triggerChar.length - 1), from) + text
                    : text;

                if (triggerChar === snippet) {
                  // Check the per-suggestion-menu filter before activating.
                  if (
                    menuOptions.shouldOpen &&
                    !menuOptions.shouldOpen(view.state.tr)
                  ) {
                    continue;
                  }
                  view.dispatch(view.state.tr.insertText(text));
                  view.dispatch(
                    view.state.tr
                      .setMeta(suggestionMenuPluginKey, {
                        type: "open",
                        triggerCharacter: snippet,
                      })
                      .scrollIntoView(),
                  );
                  return true;
                }
              }
            }
            return false;
          },

          // Setup decorator on the currently active suggestion.
          decorations(state) {
            const suggestionPluginState = getActiveSuggestionSession((
              this as Plugin
            ).getState(state));

            if (!suggestionPluginState) return null;

            // If the menu was opened programmatically by another extension, it may not use a trigger character. In this
            // case, the decoration is set on the whole block instead, as the decoration range would otherwise be empty.
            if (!suggestionPluginState.deleteTriggerCharacter) {
              const blockNode = findBlock(state.selection);
              if (blockNode) {
                return DecorationSet.create(state.doc, [
                  Decoration.node(
                    blockNode.pos,
                    blockNode.pos + blockNode.node.nodeSize,
                    {
                      nodeName: "span",
                      class: "bn-suggestion-decorator",
                      "data-decoration-id": suggestionPluginState.decorationId,
                    },
                  ),
                ]);
              }
            }
            // Creates an inline decoration around the trigger character.
            return DecorationSet.create(state.doc, [
              Decoration.inline(
                suggestionPluginState.queryStartPos() -
                  suggestionPluginState.triggerCharacter!.length,
                suggestionPluginState.queryStartPos(),
                {
                  nodeName: "span",
                  class: "bn-suggestion-decorator",
                  "data-decoration-id": suggestionPluginState.decorationId,
                },
              ),
            ]);
          },
        },
      }),
    ],
  } as const;
});
