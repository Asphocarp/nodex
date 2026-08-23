import { createExtension } from "@blocknote/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE,
  claimEditorSelectionSurface,
  clearActiveEditorSelectionSurface,
  EDITOR_SELECTION_SURFACE_ATTRIBUTE,
  EMBEDDED_EDITOR_SELECTION_CONTEXT_ATTRIBUTE,
  releaseEditorSelectionSurface,
} from "@/lib/editor-selection-presentation";

const BLOCK_CONTAINER_TYPE = "blockContainer";
const pluginKey = new PluginKey<DecorationSet>("nodex-selected-blocks");

export const SELECTED_BLOCK_CLASS = "nodex-selected-block";
export const SELECTED_BLOCK_CONTENT_ATTRIBUTE = "data-nodex-selected-block-content";
export const SELECTED_BLOCK_SCOPE_ATTRIBUTE = "data-nodex-selected-block-scope";
export const BLOCK_SELECTION_PRESENTATION_ATTRIBUTE = "data-nodex-block-selection-presentation";

const EDITOR_SELECTION_SURFACE_SELECTOR = `[${EDITOR_SELECTION_SURFACE_ATTRIBUTE}]`;
const EMBEDDED_EDITOR_SELECTION_CONTEXT_SELECTOR = `[${EMBEDDED_EDITOR_SELECTION_CONTEXT_ATTRIBUTE}]`;

export type SelectedBlockDecorationKind = "structural" | "atomic-range";

export interface SelectedBlockDecorationRange {
  readonly from: number;
  readonly to: number;
  readonly kind: SelectedBlockDecorationKind;
}

type SelectionWithNodes = Selection & {
  readonly node?: Node;
  readonly nodes?: readonly Node[];
};

function getStructurallySelectedNodes(selection: Selection): ReadonlySet<Node> {
  const selectionWithNodes = selection as SelectionWithNodes;
  if (Array.isArray(selectionWithNodes.nodes)) {
    return new Set(selectionWithNodes.nodes);
  }
  if (selectionWithNodes.node) {
    return new Set([selectionWithNodes.node]);
  }
  return new Set();
}

/** Projects the authoritative ProseMirror selection onto stable Block containers. */
export function collectSelectedBlockDecorationRanges(
  doc: Node,
  selection: Selection,
): SelectedBlockDecorationRange[] {
  if (selection.empty) return [];

  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  if (from >= to) return [];

  const structurallySelectedNodes = getStructurallySelectedNodes(selection);
  const ranges: SelectedBlockDecorationRange[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== BLOCK_CONTAINER_TYPE) return;

    const content = node.firstChild;
    if (!content) return;

    const structurallySelected =
      structurallySelectedNodes.has(node) || structurallySelectedNodes.has(content);
    const contentFrom = pos + 1;
    const contentTo = contentFrom + content.nodeSize;
    const fullyCoveredAtomicContent = content.isAtom && from <= contentFrom && to >= contentTo;

    if (!structurallySelected && !fullyCoveredAtomicContent) return;

    ranges.push({
      from: pos,
      to: pos + node.nodeSize,
      kind: structurallySelected ? "structural" : "atomic-range",
    });
    return false;
  });

  return ranges;
}

function buildSelectedBlockDecorationSet(doc: Node, selection: Selection): DecorationSet {
  const ranges = collectSelectedBlockDecorationRanges(doc, selection);
  if (ranges.length === 0) return DecorationSet.empty;

  return DecorationSet.create(
    doc,
    ranges.flatMap((range) => {
      const blockContainer = doc.nodeAt(range.from);
      const blockContent = blockContainer?.firstChild;
      const scope =
        range.kind === "structural" && blockContainer?.lastChild?.type.name === "blockGroup"
          ? "subtree"
          : "content";
      const blockDecoration = Decoration.node(
        range.from,
        range.to,
        {
          class: SELECTED_BLOCK_CLASS,
          "data-nodex-selection-kind": range.kind,
          [SELECTED_BLOCK_SCOPE_ATTRIBUTE]: scope,
        },
        { key: `block:${range.kind}:${range.from}:${range.to}` },
      );
      if (!blockContent || scope === "subtree") return [blockDecoration];

      const contentFrom = range.from + 1;
      return [
        blockDecoration,
        Decoration.node(
          contentFrom,
          contentFrom + blockContent.nodeSize,
          { [SELECTED_BLOCK_CONTENT_ATTRIBUTE]: "" },
          { key: `content:${range.kind}:${contentFrom}` },
        ),
      ];
    }),
  );
}

export function selectedBlockDecorationsExtension() {
  return createExtension({
    key: "selected-block-decorations",
    mount({ dom }) {
      dom.setAttribute(BLOCK_SELECTION_PRESENTATION_ATTRIBUTE, "");
      dom.setAttribute(EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");
      const root = dom.getRootNode();

      const handleSelectionPresentationIntent = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(EDITOR_SELECTION_SURFACE_SELECTOR) !== dom) return;

        const embeddedContext = target.closest(EMBEDDED_EDITOR_SELECTION_CONTEXT_SELECTOR);
        if (embeddedContext && dom.contains(embeddedContext)) {
          clearActiveEditorSelectionSurface(dom);
          return;
        }

        claimEditorSelectionSurface(dom);
      };

      dom.addEventListener("focusin", handleSelectionPresentationIntent);
      dom.addEventListener("pointerdown", handleSelectionPresentationIntent);

      if ("activeElement" in root && root.activeElement === dom) {
        claimEditorSelectionSurface(dom);
      }

      return () => {
        dom.removeEventListener("focusin", handleSelectionPresentationIntent);
        dom.removeEventListener("pointerdown", handleSelectionPresentationIntent);
        releaseEditorSelectionSurface(dom);
        dom.removeAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE);
        dom.removeAttribute(EDITOR_SELECTION_SURFACE_ATTRIBUTE);
        dom.removeAttribute(BLOCK_SELECTION_PRESENTATION_ATTRIBUTE);
      };
    },
    prosemirrorPlugins: [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_config, state) => buildSelectedBlockDecorationSet(state.doc, state.selection),
          apply: (transaction, previousDecorations, _oldState, newState) => {
            if (!transaction.docChanged && !transaction.selectionSet) {
              return previousDecorations;
            }
            return buildSelectedBlockDecorationSet(newState.doc, newState.selection);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ],
  });
}
