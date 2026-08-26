import { TextSelection } from "prosemirror-state";

import {
  createExtension,
  createStore,
} from "../../editor/BlockNoteExtension.js";

export const FormattingToolbarExtension = createExtension(({ editor }) => {
  const store = createStore(false);

  const shouldShow = () => {
    return editor.transact((tr) => {
      // Don't show if the selection is empty, or is a text selection with no
      // text.
      if (tr.selection.empty) {
        return false;
      }

      // Don't show if the selection is a text selection but contains no text.
      if (
        tr.selection instanceof TextSelection &&
        tr.doc.textBetween(tr.selection.from, tr.selection.to).length === 0
      ) {
        return false;
      }

      // Searches the content of the selection to see if it spans a node with a
      // code spec.
      let spansCode = false;
      tr.selection.content().content.descendants((node) => {
        if (node.type.spec.code) {
          spansCode = true;
        }
        return !spansCode; // keep descending if we haven't found a code block
      });

      // Don't show if the selection spans a code block.
      if (spansCode) {
        return false;
      }

      // Show toolbar otherwise.
      return true;
    });
  };

  return {
    key: "formattingToolbar",
    store,
    mount({ dom, root, signal }) {
      const ownerDocument =
        root.nodeType === 9 ? (root as Document) : root.ownerDocument;
      // Selection presentation becomes eligible only after its pointer or drag
      // gesture settles.
      let gesturePhase: "idle" | "selecting" | "dragging" = "idle";

      const settleGesture = () => {
        gesturePhase = "idle";
        store.setState(editor.isFocused() ? shouldShow() : false);
      };

      const unsubscribeOnChange = editor.onChange(() => {
        if (gesturePhase !== "idle") return;
        // re-evaluate whether the toolbar should be shown
        store.setState(shouldShow());
      });
      const unsubscribeOnSelectionChange = editor.onSelectionChange(() => {
        if (gesturePhase !== "idle") return;
        // re-evaluate whether the toolbar should be shown
        store.setState(shouldShow());
      });

      dom.addEventListener(
        "pointerdown",
        (event) => {
          if (editor.getInteractionOwnership(event) === "other") {
            gesturePhase = "idle";
            store.setState(false);
            return;
          }
          gesturePhase = "selecting";
          store.setState(false);
        },
        { signal },
      );
      ownerDocument.addEventListener(
        "pointerup",
        (event) => {
          if (gesturePhase !== "selecting") return;
          if (editor.getInteractionOwnership(event) === "other") {
            gesturePhase = "idle";
            store.setState(false);
            return;
          }
          settleGesture();
        },
        { signal, capture: true },
      );
      ownerDocument.addEventListener(
        "pointercancel",
        (event) => {
          if (gesturePhase !== "selecting") return;
          if (editor.getInteractionOwnership(event) === "other") {
            gesturePhase = "idle";
            store.setState(false);
            return;
          }
          settleGesture();
        },
        { signal, capture: true },
      );

      root.addEventListener(
        "dragstart",
        (event) => {
          if (editor.getInteractionOwnership(event) === "other") {
            gesturePhase = "idle";
            store.setState(false);
            return;
          }
          if (!event.target || !dom.contains(event.target as Node)) return;
          gesturePhase = "dragging";
          store.setState(false);
        },
        { signal },
      );

      ownerDocument.addEventListener(
        "dragend",
        () => {
          if (gesturePhase !== "dragging") return;
          settleGesture();
        },
        { signal },
      );

      root.addEventListener(
        "focusin",
        (event) => {
          if (editor.getInteractionOwnership(event) !== "other") return;
          gesturePhase = "idle";
          store.setState(false);
        },
        { signal, capture: true },
      );

      const editorWindow = ownerDocument.defaultView;
      editorWindow?.addEventListener(
        "blur",
        () => {
          gesturePhase = "idle";
          store.setState(false);
        },
        { signal },
      );

      signal.addEventListener("abort", () => {
        gesturePhase = "idle";
        unsubscribeOnChange();
        unsubscribeOnSelectionChange();
        store.setState(false);
      });
    },
  } as const;
});
