import {
  AnyExtension as AnyTiptapExtension,
  extensions,
  Node,
  Extension as TiptapExtension,
} from "@tiptap/core";
import { Gapcursor } from "@tiptap/extensions/gap-cursor";
import { Plugin, type Transaction } from "prosemirror-state";
import { ySyncPluginKey } from "y-prosemirror";
import { LinkExtension } from "../../../extensions/tiptap-extensions/Link/link.js";
import { Text } from "@tiptap/extension-text";
import { createDropFileExtension } from "../../../api/clipboard/fromClipboard/fileDropExtension.js";
import { createPasteFromClipboardExtension } from "../../../api/clipboard/fromClipboard/pasteExtension.js";
import { createCopyToClipboardExtension } from "../../../api/clipboard/toClipboard/copyExtension.js";
import {
  BlockChangeExtension,
  DropCursorExtension,
  FilePanelExtension,
  FormattingToolbarExtension,
  HistoryExtension,
  LinkToolbarExtension,
  NodeSelectionKeyboardExtension,
  PlaceholderExtension,
  PreviousBlockTypeExtension,
  ShowSelectionExtension,
  SideMenuExtension,
  SuggestionMenu,
  TableHandlesExtension,
  TrailingNodeExtension,
} from "../../../extensions/index.js";
import {
  BackgroundColorExtension,
  HardBreak,
  KeyboardShortcutsExtension,
  SuggestionAddMark,
  SuggestionDeleteMark,
  SuggestionModificationMark,
  TextAlignmentExtension,
  TextColorExtension,
  UniqueID,
} from "../../../extensions/tiptap-extensions/index.js";
import { BlockContainer, BlockGroup, Doc } from "../../../pm-nodes/index.js";
import {
  BlockNoteEditor,
  BlockNoteEditorOptions,
} from "../../BlockNoteEditor.js";
import { ExtensionFactoryInstance } from "../../BlockNoteExtension.js";
import { CollaborationExtension } from "../../../extensions/Collaboration/Collaboration.js";

const isCollaborationChangeOrigin = (transaction: Transaction): boolean => {
  const metadata = transaction.getMeta(ySyncPluginKey);
  if (!metadata || typeof metadata !== "object") return false;
  return "isChangeOrigin" in metadata && metadata.isChangeOrigin === true;
};

const blockContainerAcceptsChildren = (
  node: import("prosemirror-model").Node,
  editor: BlockNoteEditor<any, any, any>,
): boolean => {
  if (node.type.name !== "blockContainer" || node.childCount < 2) return true;
  const content = node.firstChild;
  if (!content) return false;
  return editor.schema.acceptsBlockChildren({
    type: content.type.name,
    props: content.attrs,
  });
};

/** Validates only changed ranges and their ancestor Block containers. */
const transactionPreservesBlockChildrenContract = (
  transaction: Transaction,
  editor: BlockNoteEditor<any, any, any>,
): boolean => {
  if (!transaction.docChanged || isCollaborationChangeOrigin(transaction)) return true;

  let valid = true;
  const validatePosition = (position: number) => {
    const resolved = transaction.doc.resolve(
      Math.max(0, Math.min(position, transaction.doc.content.size)),
    );
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (!blockContainerAcceptsChildren(resolved.node(depth), editor)) {
        valid = false;
        return;
      }
    }
  };

  for (const [stepIndex, step] of transaction.steps.entries()) {
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (!valid) return;
      const remainingMapping = transaction.mapping.slice(stepIndex + 1);
      const finalStart = remainingMapping.map(newStart, -1);
      const finalEnd = remainingMapping.map(newEnd, 1);
      validatePosition(finalStart);
      validatePosition(finalEnd);
      transaction.doc.nodesBetween(finalStart, finalEnd, (node) => {
        if (!blockContainerAcceptsChildren(node, editor)) {
          valid = false;
          return false;
        }
        return valid;
      });
    });
    if (!valid) return false;
  }
  return valid;
};

/**
 * Get all the Tiptap extensions BlockNote is configured with by default
 */
export function getDefaultTiptapExtensions(
  editor: BlockNoteEditor<any, any, any>,
  options: BlockNoteEditorOptions<any, any, any>,
) {
  const tiptapExtensions: AnyTiptapExtension[] = [
    extensions.ClipboardTextSerializer,
    extensions.Commands,
    extensions.Editable,
    extensions.FocusEvents,
    extensions.Tabindex,
    Gapcursor,

    UniqueID.configure({
      // everything from bnBlock group (nodes that represent a BlockNote block should have an id)
      types: ["blockContainer", "columnList", "column"],
      ...(options.generateBlockId
        ? { generateID: options.generateBlockId }
        : {}),
      setIdAttribute: options.setIdAttribute,
      isWithinEditor: editor.isWithinEditor,
      // y-prosemirror renders authoritative Yjs changes by replacing the
      // ProseMirror document. UniqueID must never reinterpret that replacement
      // as locally inserted Blocks or it can feed generated IDs/content back
      // into Yjs repeatedly. Local paste/drop transactions still pass through
      // and receive fresh IDs before collaboration persists them.
      filterTransaction: (transaction) =>
        !isCollaborationChangeOrigin(transaction),
    }),
    TiptapExtension.create({
      name: "BlockChildrenContract",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            filterTransaction: (transaction) =>
              transactionPreservesBlockChildrenContract(transaction, editor),
          }),
        ];
      },
    }),
    HardBreak,
    Text,

    // marks:
    SuggestionAddMark,
    SuggestionDeleteMark,
    SuggestionModificationMark,
    ...(Object.values(editor.schema.styleSpecs).map((styleSpec) => {
      return styleSpec.implementation.mark.configure({
        editor: editor,
      });
    }) as any[]),

    TextColorExtension,

    BackgroundColorExtension,
    TextAlignmentExtension,

    // make sure escape blurs editor, so that we can tab to other elements in the host page (accessibility)
    TiptapExtension.create({
      name: "OverrideEscape",
      addKeyboardShortcuts: () => {
        return {
          Escape: () => {
            if (editor.getExtension(SuggestionMenu)?.shown()) {
              // escape should close the suggestion menu, but not blur the editor
              return false;
            }
            editor.blur();
            return true;
          },
        };
      },
    }),

    // nodes
    Doc,
    BlockContainer.configure({
      editor: editor,
      domAttributes: options.domAttributes,
    }),
    KeyboardShortcutsExtension.configure({
      editor: editor,
      tabBehavior: options.tabBehavior,
    }),
    BlockGroup.configure({
      domAttributes: options.domAttributes,
    }),
    ...Object.values(editor.schema.inlineContentSpecs)
      .filter((a) => a.config !== "link" && a.config !== "text")
      .map((inlineContentSpec) => {
        return inlineContentSpec.implementation!.node.configure({
          editor: editor,
        });
      }),

    ...Object.values(editor.schema.blockSpecs).flatMap((blockSpec) => {
      return [
        // the node extension implementations
        ...("node" in blockSpec.implementation
          ? [
              (blockSpec.implementation.node as Node).configure({
                editor: editor,
                domAttributes: options.domAttributes,
              }),
            ]
          : []),
      ];
    }),
    createCopyToClipboardExtension(editor),
    createPasteFromClipboardExtension(
      editor,
      options.pasteHandler ||
        ((context: {
          defaultPasteHandler: (context?: {
            prioritizeMarkdownOverHTML?: boolean;
            plainTextAsMarkdown?: boolean;
          }) => boolean | undefined;
        }) => context.defaultPasteHandler()),
    ),
    createDropFileExtension(editor),
  ];

  return tiptapExtensions;
}

export function getDefaultExtensions(
  editor: BlockNoteEditor<any, any, any>,
  options: BlockNoteEditorOptions<any, any, any>,
) {
  const extensions = [
    BlockChangeExtension(),
    DropCursorExtension(options),
    FilePanelExtension(options),
    FormattingToolbarExtension(options),
    LinkExtension({
      HTMLAttributes: options.links?.HTMLAttributes ?? {},
      onClick: options.links?.onClick,
      ...(options.links?.isValidLink
        ? { isValidLink: options.links.isValidLink }
        : {}),
    }),
    LinkToolbarExtension(options),
    NodeSelectionKeyboardExtension(),
    PlaceholderExtension(options),
    ShowSelectionExtension(options),
    SideMenuExtension(options),
    SuggestionMenu(options),
    ...(options.trailingBlock !== false ? [TrailingNodeExtension()] : []),
  ] as ExtensionFactoryInstance[];

  if (options.collaboration) {
    extensions.push(CollaborationExtension(options.collaboration));
  } else {
    // YUndo is not compatible with ProseMirror's history plugin
    extensions.push(HistoryExtension());
  }

  if ("table" in editor.schema.blockSpecs) {
    extensions.push(TableHandlesExtension(options));
  }

  if (options.animations !== false) {
    extensions.push(PreviousBlockTypeExtension());
  }

  return extensions;
}
