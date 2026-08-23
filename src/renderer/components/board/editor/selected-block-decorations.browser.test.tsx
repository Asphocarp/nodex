import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  type CustomBlockConfig,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { ShowSelectionExtension } from "@blocknote/core/extensions";
import type { Node } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "../../../globals.css";
import { PageOutlinerFrame } from "@/components/block-documents/page-outliner-surface";
import { ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE } from "@/lib/editor-selection-presentation";
import {
  applySideMenuSelectionIntent,
  createSideMenuSelectionIntent,
  type SideMenuSelectionBlock,
  type SideMenuSelectionEditor,
} from "./nfm-side-menu-selection";
import { selectedBlockDecorationsExtension } from "./selected-block-decorations";
import { nfmSchema } from "./nfm-schema";

const testPageBlockConfig = {
  type: "testPage",
  propSchema: {},
  content: "none",
} as const satisfies CustomBlockConfig;

const testPageBlockSpec = createReactBlockSpec(testPageBlockConfig, {
  render: () => <section data-test-page-title>Atomic page title</section>,
});

const testSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    testPage: testPageBlockSpec(),
  },
});

const settleEditor = async () => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

function inlinePosition(doc: Node, blockId: string, offset: number) {
  let position: number | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockContainer" || node.attrs.id !== blockId) return true;
    position = pos + 2 + offset;
    return false;
  });
  if (position === undefined) throw new Error(`Missing fixture Block ${blockId}`);
  return position;
}

describe("selected Block presentation in Chromium", () => {
  test("ignores a stale React NodeView selection class after text selection moves away", async () => {
    const editor = BlockNoteEditor.create({
      schema: testSchema,
      initialContent: [
        { id: "before", type: "paragraph", content: "123456789" },
        { id: "page", type: "testPage" },
        { id: "after", type: "paragraph", content: "after" },
      ],
      extensions: [selectedBlockDecorationsExtension()],
    });
    const view = render(
      <BlockNoteView
        editor={editor}
        className="nfm-editor"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      />,
    );

    try {
      await act(settleEditor);
      await act(async () => {
        editor.focus();
        editor.setTextCursorPosition("page");
        await settleEditor();
      });

      const pageContainer = view.container.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="page"]',
      );
      const pageNodeView = pageContainer?.querySelector<HTMLElement>(".ProseMirror-selectednode");
      const pageContent = pageContainer?.querySelector<HTMLElement>(
        '.bn-block-content[data-content-type="testPage"]',
      );
      const pageTitle = pageContainer?.querySelector<HTMLElement>("[data-test-page-title]");
      if (!pageContainer || !pageNodeView || !pageContent || !pageTitle) {
        throw new Error("Expected the selected atomic React Block");
      }

      expect(pageContainer.classList.contains("nodex-selected-block")).toBe(true);
      expect(pageContainer.dataset.nodexSelectionKind).toBe("structural");
      expect(getComputedStyle(pageContent, "::after").backgroundColor).toBe(
        "rgba(35, 131, 226, 0.14)",
      );
      expect(getComputedStyle(pageContent, "::after").opacity).toBe("1");
      expect(getComputedStyle(pageTitle).outlineStyle).toBe("none");

      await act(async () => {
        const doc = editor.prosemirrorState.doc;
        editor.prosemirrorView.dispatch(
          editor.prosemirrorState.tr.setSelection(
            TextSelection.create(
              doc,
              inlinePosition(doc, "before", 6),
              inlinePosition(doc, "before", 7),
            ),
          ),
        );
        await settleEditor();
      });

      expect(
        editor.prosemirrorState.doc.textBetween(
          editor.prosemirrorState.selection.from,
          editor.prosemirrorState.selection.to,
        ),
      ).toBe("7");
      expect(pageContainer.classList.contains("nodex-selected-block")).toBe(false);

      const showSelection = editor.getExtension(ShowSelectionExtension);
      showSelection?.showSelection(true, "inline-selection-test");
      await act(settleEditor);
      expect(view.container.querySelectorAll("[data-show-selection]")).toHaveLength(1);
      expect(view.container.querySelector("[data-show-selection]")?.textContent).toBe("7");
      showSelection?.showSelection(false, "inline-selection-test");
      await act(settleEditor);

      pageNodeView.classList.add("ProseMirror-selectednode");
      expect(getComputedStyle(pageTitle).outlineStyle).toBe("none");
      expect(getComputedStyle(pageContent, "::after").content).toBe("none");

      await act(async () => {
        const doc = editor.prosemirrorState.doc;
        editor.prosemirrorView.dispatch(
          editor.prosemirrorState.tr.setSelection(
            TextSelection.create(
              doc,
              inlinePosition(doc, "before", 6),
              inlinePosition(doc, "after", 2),
            ),
          ),
        );
        await settleEditor();
      });

      expect(pageContainer.classList.contains("nodex-selected-block")).toBe(true);
      expect(pageContainer.dataset.nodexSelectionKind).toBe("atomic-range");
      expect(getComputedStyle(pageContent, "::after").backgroundColor).toBe(
        "rgba(35, 131, 226, 0.14)",
      );
      expect(getComputedStyle(pageContent, "::after").opacity).toBe("1");
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });

  test("keeps the Image overlay in sync with the same authoritative selection", async () => {
    const editor = BlockNoteEditor.create({
      schema: nfmSchema,
      initialContent: [
        { id: "before", type: "paragraph", content: "123456789" },
        {
          id: "image",
          type: "image",
          props: {
            url: "data:image/png;base64,YQ==",
            caption: "",
            name: "fixture.png",
            showPreview: true,
          },
        },
        { id: "after", type: "paragraph", content: "after" },
      ],
      extensions: [selectedBlockDecorationsExtension()],
    });
    const view = render(
      <BlockNoteView
        editor={editor}
        className="nfm-editor"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      />,
    );

    try {
      await act(settleEditor);
      await act(async () => {
        editor.focus();
        editor.setTextCursorPosition("image");
        await settleEditor();
      });

      const imageContainer = view.container.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="image"]',
      );
      const imageNodeView = imageContainer?.querySelector<HTMLElement>(".ProseMirror-selectednode");
      const imageContent = imageContainer?.querySelector<HTMLElement>(
        '.bn-block-content[data-content-type="image"]',
      );
      const imageWrapper = imageContent?.querySelector<HTMLElement>(
        ".bn-file-block-content-wrapper",
      );
      if (!imageContainer || !imageNodeView || !imageContent || !imageWrapper) {
        throw new Error("Expected the selected Image Block");
      }

      expect(imageContainer.dataset.nodexSelectionKind).toBe("structural");
      expect(getComputedStyle(imageContent, "::after").content).toBe("none");
      expect(getComputedStyle(imageWrapper, "::after").backgroundColor).toBe(
        "rgba(35, 131, 226, 0.14)",
      );
      expect(getComputedStyle(imageWrapper, "::after").opacity).toBe("1");

      await act(async () => {
        const doc = editor.prosemirrorState.doc;
        editor.prosemirrorView.dispatch(
          editor.prosemirrorState.tr.setSelection(
            TextSelection.create(
              doc,
              inlinePosition(doc, "before", 6),
              inlinePosition(doc, "before", 7),
            ),
          ),
        );
        await settleEditor();
      });

      imageNodeView.classList.add("ProseMirror-selectednode");
      expect(imageContainer.classList.contains("nodex-selected-block")).toBe(false);
      expect(getComputedStyle(imageWrapper, "::after").content).toBe("none");
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });

  test("presents a side-menu parent selection as one subtree overlay", async () => {
    const editor = BlockNoteEditor.create({
      schema: testSchema,
      initialContent: [
        {
          id: "parent",
          type: "paragraph",
          content: "release again",
          children: [
            { id: "child-one", type: "paragraph", content: "release current" },
            { id: "child-two", type: "paragraph", content: "use prod nodex" },
          ],
        },
        { id: "after", type: "paragraph", content: "after" },
      ],
      extensions: [selectedBlockDecorationsExtension()],
    });
    const view = render(
      <BlockNoteView
        editor={editor}
        className="nfm-editor"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      />,
    );

    try {
      await act(settleEditor);
      await act(async () => {
        editor.focus();
        const parent = editor.getBlock("parent");
        if (!parent) throw new Error("Missing parent Block");

        const sideMenuEditor = editor as unknown as SideMenuSelectionEditor;
        const intent = createSideMenuSelectionIntent(
          sideMenuEditor,
          parent as unknown as SideMenuSelectionBlock,
        );
        applySideMenuSelectionIntent(sideMenuEditor, intent);
        await settleEditor();
      });

      const parentOuter = view.container.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="parent"]',
      );
      const parentBlock = parentOuter?.querySelector<HTMLElement>(":scope > .bn-block");
      const parentContent = parentBlock?.querySelector<HTMLElement>(
        ':scope > .bn-block-content[data-content-type="paragraph"]',
      );
      const childContent = parentBlock?.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="child-two"] .bn-block-content[data-content-type="paragraph"]',
      );
      const parentInlineContent = parentContent?.querySelector<HTMLElement>(".bn-inline-content");
      const childInlineContent = childContent?.querySelector<HTMLElement>(".bn-inline-content");
      if (
        !parentOuter ||
        !parentBlock ||
        !parentContent ||
        !childContent ||
        !parentInlineContent ||
        !childInlineContent
      ) {
        throw new Error("Expected the selected parent subtree");
      }

      expect(parentOuter.dataset.nodexSelectedBlockScope).toBe("subtree");
      expect(editor.prosemirrorState.selection.visible).toBe(false);
      expect(editor.prosemirrorView.dom.classList.contains("ProseMirror-hideselection")).toBe(true);
      editor.getExtension(ShowSelectionExtension)?.showSelection(true, "structural-selection-test");
      await act(settleEditor);
      expect(parentBlock.querySelector("[data-show-selection]")).toBeNull();
      expect(parentBlock.querySelector("[data-nodex-selected-block-content]")).toBeNull();
      expect(getComputedStyle(parentBlock, "::after").backgroundColor).toBe(
        "rgba(35, 131, 226, 0.14)",
      );
      expect(getComputedStyle(parentBlock, "::after").opacity).toBe("1");
      expect(parentBlock.getBoundingClientRect().height).toBeGreaterThan(
        parentContent.getBoundingClientRect().height,
      );
      expect(parentBlock.getBoundingClientRect().top).toBeLessThan(
        childContent.getBoundingClientRect().top,
      );
      expect(getComputedStyle(parentInlineContent, "::selection").backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(getComputedStyle(childInlineContent, "::selection").backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });

  test("gives nested editors exclusive Block highlight ownership inside a Page context", async () => {
    const innerEditor = BlockNoteEditor.create({
      schema: nfmSchema,
      initialContent: [
        {
          id: "image-one",
          type: "image",
          props: {
            url: "data:image/png;base64,YQ==",
            caption: "",
            name: "one.png",
            showPreview: true,
          },
        },
        {
          id: "image-two",
          type: "image",
          props: {
            url: "data:image/png;base64,Yg==",
            caption: "",
            name: "two.png",
            showPreview: true,
          },
        },
      ],
      extensions: [selectedBlockDecorationsExtension()],
    });
    const nestedPageBlockSpec = createReactBlockSpec(testPageBlockConfig, {
      render: () => (
        <PageOutlinerFrame targetBlockId="nested-page" expanded active>
          <BlockNoteView
            editor={innerEditor}
            className="nfm-editor"
            formattingToolbar={false}
            linkToolbar={false}
            slashMenu={false}
            sideMenu={false}
            tableHandles={false}
          />
        </PageOutlinerFrame>
      ),
    });
    const outerSchema = BlockNoteSchema.create({
      blockSpecs: {
        paragraph: defaultBlockSpecs.paragraph,
        testPage: nestedPageBlockSpec(),
      },
    });
    const outerEditor = BlockNoteEditor.create({
      schema: outerSchema,
      initialContent: [
        { id: "before", type: "paragraph", content: "before" },
        { id: "page", type: "testPage" },
      ],
      extensions: [selectedBlockDecorationsExtension()],
    });
    const view = render(
      <BlockNoteView
        editor={outerEditor}
        className="nfm-editor"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      />,
    );

    try {
      await act(settleEditor);
      await act(async () => {
        outerEditor.focus();
        outerEditor.setTextCursorPosition("page");
        await settleEditor();
      });

      const pageContainer = view.container.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="page"]',
      );
      const pageContent = pageContainer?.querySelector<HTMLElement>(
        '.bn-block-content[data-content-type="testPage"]',
      );
      const pageFrame = pageContainer?.querySelector<HTMLElement>(
        '[data-page-outliner-target="nested-page"]',
      );
      if (!pageContainer || !pageContent || !pageFrame) {
        throw new Error("Expected the selected Page context");
      }

      expect(pageContainer.classList.contains("nodex-selected-block")).toBe(true);
      expect(
        outerEditor.prosemirrorView.dom.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE),
      ).toBe(true);

      const firstImageWrapper = view.container.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="image-one"] .bn-file-block-content-wrapper',
      );
      const firstImage = firstImageWrapper?.querySelector<HTMLImageElement>("img");
      const secondImageWrapper = view.container.querySelector<HTMLElement>(
        '.bn-block-outer[data-id="image-two"] .bn-file-block-content-wrapper',
      );
      if (!firstImageWrapper || !firstImage || !secondImageWrapper) {
        throw new Error("Expected both nested Image Blocks");
      }

      await act(async () => {
        await userEvent.click(firstImage);
        await settleEditor();
        await new Promise<void>((resolve) => setTimeout(resolve, 225));
      });

      expect(pageContainer.classList.contains("nodex-selected-block")).toBe(true);
      expect(outerEditor.prosemirrorView.hasFocus()).toBe(false);
      expect(innerEditor.prosemirrorView.hasFocus()).toBe(true);
      expect(
        outerEditor.prosemirrorView.dom.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE),
      ).toBe(false);
      expect(
        innerEditor.prosemirrorView.dom.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE),
      ).toBe(true);
      expect(getComputedStyle(pageContent, "::after").opacity).toBe("0");
      expect(getComputedStyle(firstImageWrapper, "::after").backgroundColor).toBe(
        "rgba(35, 131, 226, 0.14)",
      );
      expect(getComputedStyle(firstImageWrapper, "::after").opacity).toBe("1");
      expect(getComputedStyle(secondImageWrapper, "::after").content).toBe("none");
      expect(getComputedStyle(pageFrame, "::after").borderColor).toBe("rgb(243, 221, 203)");
      expect(getComputedStyle(pageFrame, "::after").opacity).toBe("1");
    } finally {
      view.unmount();
      innerEditor._tiptapEditor.destroy();
      outerEditor._tiptapEditor.destroy();
    }
  });
});
