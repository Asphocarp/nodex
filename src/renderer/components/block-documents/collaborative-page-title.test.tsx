import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  readPortableRichTextFromYText,
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../../shared/block-documents/portable-rich-text";
import { render } from "@/test/dom";
import {
  readRichTitleDomSelection,
  restoreRichTitleDomSelection,
} from "@/lib/rich-title-editor-dom";
import { CollaborativePageTitle } from "./collaborative-page-title";
import type {
  BlockDocumentSurfaceRelocationPreparation,
  BlockDocumentSurfaceRelocationPreparer,
  BlockDocumentSurfaceWriteFence,
} from "@/lib/block-document-surface-runtime";

class TestSurfaceWriteFence implements BlockDocumentSurfaceWriteFence {
  private frozen = false;
  private readonly listeners = new Set<() => void>();
  private readonly preparers = new Set<BlockDocumentSurfaceRelocationPreparer>();

  getWriteFrozen = (): boolean => this.frozen;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  registerRelocationPreparer = (
    preparer: BlockDocumentSurfaceRelocationPreparer,
  ): (() => void) => {
    this.preparers.add(preparer);
    return () => this.preparers.delete(preparer);
  };
  setFrozen = (frozen: boolean): void => {
    this.frozen = frozen;
    for (const listener of this.listeners) listener();
  };
  prepare = async (): Promise<void> => {
    const event: BlockDocumentSurfaceRelocationPreparation = {
      kind: "relocation-lease-prepare",
      leaseId: "lease-title",
      documentId: "document:title-test",
      clientSessionId: "title-window",
      storeEpoch: "store-1",
      generation: 1,
      expectedHeadSeq: 1,
      deadlineAt: Date.now() + 10_000,
    };
    await Promise.all([...this.preparers].map((prepare) => prepare(event)));
  };
}

const createTitle = (
  initialValue: string | PortableRichText,
): { readonly document: Y.Doc; readonly title: Y.Text } => {
  const document = new Y.Doc({ guid: "document:title-test" });
  const title = document.getText("title");
  if (typeof initialValue === "string") {
    if (initialValue.length > 0) title.insert(0, initialValue);
  } else {
    replaceYTextWithPortableRichText(title, initialValue);
  }
  return { document, title };
};

const replaceEditorDraft = (
  editor: HTMLDivElement,
  value: string,
  isComposing = false,
): void => {
  editor.textContent = value;
  fireEvent.input(editor, { isComposing });
};

describe("CollaborativePageTitle", () => {
  test("writes a local DOM draft as a minimal Y.Text transaction and reports authority", async () => {
    const { document, title } = createTitle("Page alpha");
    const reportedValues: string[] = [];
    const observedDeltas: string[] = [];
    title.observe((event) => observedDeltas.push(JSON.stringify(event.delta)));
    const view = render(
      <CollaborativePageTitle
        title={title}
        onValueChange={(value) => reportedValues.push(value)}
      />,
    );
    const editor = view.getByRole("textbox", { name: "Page title" }) as HTMLDivElement;

    await act(async () => {
      replaceEditorDraft(editor, "Page beta");
      await Promise.resolve();
    });

    expect(title.toString()).toBe("Page beta");
    expect(observedDeltas).toEqual([
      JSON.stringify([{ retain: 5 }, { delete: 4 }, { insert: "bet" }]),
    ]);
    expect(reportedValues).toEqual(["Page alpha", "Page beta"]);

    await act(async () => {
      document.transact(() => title.insert(0, "Remote "), "remote");
      await Promise.resolve();
    });
    expect(editor.textContent).toBe("Remote Page beta");
    expect(reportedValues.at(-1)).toBe("Remote Page beta");
    document.destroy();
  });

  test("renders and toggles canonical rich formatting without replacing text", async () => {
    const { document, title } = createTitle([
      { type: "text", text: "Rich ", styles: { italic: true } },
      { type: "link", text: "title", href: "https://nodex.local", styles: {} },
      { type: "threadMention", uuid: "thread-12345678" },
    ]);
    const view = render(<CollaborativePageTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Page title" }) as HTMLDivElement;
    expect(editor.querySelector("[data-rich-title-link]")?.textContent).toBe("title");
    expect(editor.querySelector("[data-rich-title-atom]")?.textContent).toBe("@thread-1");

    await act(async () => {
      editor.focus();
      restoreRichTitleDomSelection(editor, 0, 4);
      fireEvent.keyDown(editor, { key: "b", metaKey: true });
      await Promise.resolve();
    });
    expect(readPortableRichTextFromYText(title)[0]).toEqual({
      type: "text",
      text: "Rich",
      styles: { bold: true, italic: true },
    });
    document.destroy();
  });

  test("keeps the selection alive while the inline link editor applies a URL", async () => {
    const { document, title } = createTitle("Link title");
    const view = render(<CollaborativePageTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Page title" }) as HTMLDivElement;
    await act(async () => {
      editor.focus();
      restoreRichTitleDomSelection(editor, 0, 4);
      const ownerDocument = editor.ownerDocument;
      const EventConstructor = ownerDocument.defaultView?.Event ?? Event;
      fireEvent(ownerDocument, new EventConstructor("selectionchange"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Edit title link" }));
      await Promise.resolve();
    });
    const input = view.getByRole("textbox", { name: "Title link URL" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://nodex.local" } });
      const form = input.closest("form");
      if (!form) throw new TypeError("Missing title link form");
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(readPortableRichTextFromYText(title)[0]).toEqual({
      type: "link",
      text: "Link",
      href: "https://nodex.local",
      styles: {},
    });
    expect(editor.ownerDocument.activeElement).toBe(editor);
    document.destroy();
  });

  test("rebases an IME draft over remote edits without replacing either intent", async () => {
    const { document, title } = createTitle("hello world");
    const view = render(<CollaborativePageTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Page title" }) as HTMLDivElement;

    await act(async () => {
      editor.focus();
      fireEvent.compositionStart(editor);
      replaceEditorDraft(editor, "hello brave world", true);
      document.transact(() => title.insert(0, "remote "), "remote");
      await Promise.resolve();
    });
    expect(editor.textContent).toBe("hello brave world");
    expect(title.toString()).toBe("remote hello world");

    await act(async () => {
      fireEvent.compositionEnd(editor);
      await Promise.resolve();
    });
    expect(title.toString()).toBe("remote hello brave world");
    expect(editor.textContent).toBe("remote hello brave world");
    document.destroy();
  });

  test("does not let an external Enter handler cancel active IME composition", async () => {
    const { document, title } = createTitle("Page");
    let forwardedKeyDownCount = 0;
    const view = render(
      <CollaborativePageTitle
        title={title}
        onKeyDown={(event) => {
          forwardedKeyDownCount += 1;
          if (event.key === "Enter") event.preventDefault();
        }}
      />,
    );
    const editor = view.getByRole("textbox", { name: "Page title" });
    let wasNotCancelled = false;
    await act(async () => {
      fireEvent.compositionStart(editor);
      wasNotCancelled = fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
      await Promise.resolve();
    });
    expect(wasNotCancelled).toBe(true);
    expect(forwardedKeyDownCount).toBe(0);
    document.destroy();
  });

  test("local undo preserves a later remote title edit", async () => {
    const { document, title } = createTitle("Title");
    const view = render(<CollaborativePageTitle title={title} />);
    const editor = view.getByRole("textbox", { name: "Page title" }) as HTMLDivElement;
    await act(async () => {
      editor.focus();
      replaceEditorDraft(editor, "Title local");
      document.transact(() => title.insert(0, "Remote "), "remote");
      fireEvent.keyDown(editor, { key: "z", metaKey: true });
      await Promise.resolve();
    });
    expect(title.toString()).toBe("Remote Title");
    expect(editor.textContent).toBe("Remote Title");
    document.destroy();
  });

  test("preserves a focused DOM selection through a remote insertion", async () => {
    const { document, title } = createTitle("Hello world");
    const externalRef: { current: HTMLDivElement | null } = { current: null };
    const view = render(<CollaborativePageTitle title={title} ref={externalRef} />);
    const editor = view.getByRole("textbox", { name: "Page title" }) as HTMLDivElement;
    await act(async () => {
      editor.focus();
      restoreRichTitleDomSelection(editor, 6, 11);
      document.transact(() => title.insert(0, "Remote "), "remote");
      await Promise.resolve();
    });
    expect(externalRef.current).toBe(editor);
    expect(editor.textContent).toBe("Remote Hello world");
    expect(readRichTitleDomSelection(editor)).toMatchObject({ start: 13, end: 18 });
    document.destroy();
  });

  test("keeps two mounted clients convergent across text and formatting updates", async () => {
    const first = createTitle("Shared title");
    const secondDocument = new Y.Doc({ guid: first.document.guid });
    Y.applyUpdate(secondDocument, Y.encodeStateAsUpdate(first.document));
    const secondTitle = secondDocument.getText("title");
    const view = render(
      <>
        <CollaborativePageTitle title={first.title} aria-label="First client" />
        <CollaborativePageTitle title={secondTitle} aria-label="Second client" />
      </>,
    );
    const firstEditor = view.getByRole("textbox", { name: "First client" }) as HTMLDivElement;
    const secondEditor = view.getByRole("textbox", { name: "Second client" }) as HTMLDivElement;

    await act(async () => {
      replaceEditorDraft(firstEditor, "Shared collaborative title");
      Y.applyUpdate(
        secondDocument,
        Y.encodeStateAsUpdate(first.document, Y.encodeStateVector(secondDocument)),
        "provider:first-to-second",
      );
      await Promise.resolve();
    });
    expect(secondEditor.textContent).toBe("Shared collaborative title");

    await act(async () => {
      secondEditor.focus();
      restoreRichTitleDomSelection(secondEditor, 0, 6);
      fireEvent.keyDown(secondEditor, { key: "i", metaKey: true });
      Y.applyUpdate(
        first.document,
        Y.encodeStateAsUpdate(secondDocument, Y.encodeStateVector(first.document)),
        "provider:second-to-first",
      );
      await Promise.resolve();
    });
    expect(readPortableRichTextFromYText(first.title)).toEqual(
      readPortableRichTextFromYText(secondTitle),
    );
    first.document.destroy();
    secondDocument.destroy();
  });

  test("commits its IME draft and freezes only the leased surface", async () => {
    const first = createTitle("First");
    const second = createTitle("Second");
    const firstFence = new TestSurfaceWriteFence();
    const secondFence = new TestSurfaceWriteFence();
    const view = render(
      <>
        <CollaborativePageTitle
          title={first.title}
          aria-label="First title"
          surfaceWriteFence={firstFence}
        />
        <CollaborativePageTitle
          title={second.title}
          aria-label="Second title"
          surfaceWriteFence={secondFence}
        />
      </>,
    );
    const firstEditor = view.getByRole("textbox", { name: "First title" }) as HTMLDivElement;
    const secondEditor = view.getByRole("textbox", { name: "Second title" }) as HTMLDivElement;
    await act(async () => {
      firstEditor.focus();
      fireEvent.compositionStart(firstEditor);
      replaceEditorDraft(firstEditor, "First draft", true);
      firstFence.setFrozen(true);
      await firstFence.prepare();
    });
    expect(first.title.toString()).toBe("First draft");
    expect(firstEditor.getAttribute("aria-disabled")).toBe("true");
    expect(firstEditor.ownerDocument.activeElement).not.toBe(firstEditor);

    await act(async () => {
      secondEditor.focus();
      await firstFence.prepare();
    });
    expect(secondEditor.ownerDocument.activeElement).toBe(secondEditor);
    first.document.destroy();
    second.document.destroy();
  });
});
