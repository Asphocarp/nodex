import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { MAX_PAGE_TITLE_LENGTH } from "../../shared/page-limits";
import {
  YTextInputReconciliationError,
  applyYTextInputReconciliation,
  computeMinimalYTextEdit,
  reconcileYTextInputValues,
} from "./y-text-input";

const createTitle = (
  value: string,
): { readonly doc: Y.Doc; readonly text: Y.Text } => {
  const doc = new Y.Doc();
  const text = doc.getText("title");
  if (value.length > 0) text.insert(0, value);
  return { doc, text };
};

describe("Y.Text title input", () => {
  test("computes no-op, insert, delete, and replace as one minimal edit", () => {
    expect(computeMinimalYTextEdit("Title", "Title")).toBe(null);

    const insert = computeMinimalYTextEdit("Title", "My Title");
    expect(insert?.index).toBe(0);
    expect(insert?.deleteLength).toBe(0);
    expect(insert?.insertText).toBe("My ");

    const deletion = computeMinimalYTextEdit("My Title", "Title");
    expect(deletion?.index).toBe(0);
    expect(deletion?.deleteLength).toBe(3);
    expect(deletion?.insertText).toBe("");

    const replacement = computeMinimalYTextEdit("Card alpha", "Card beta");
    expect(replacement?.index).toBe(5);
    expect(replacement?.deleteLength).toBe(4);
    expect(replacement?.insertText).toBe("bet");
  });

  test("uses UTF-16 Yjs indexes without splitting surrogate pairs", () => {
    const replacement = computeMinimalYTextEdit("A😀B", "A💡B");
    expect(replacement?.index).toBe(1);
    expect(replacement?.deleteLength).toBe(2);
    expect(replacement?.insertText).toBe("💡");

    const insertion = computeMinimalYTextEdit("A😀B", "A😀!B");
    expect(insertion?.index).toBe(3);
    expect(insertion?.deleteLength).toBe(0);
    expect(insertion?.insertText).toBe("!");
  });

  test("pure reconciliation preserves a remote insertion during local composition", () => {
    const reconciliation = reconcileYTextInputValues({
      baseValue: "hello world",
      currentValue: "remote hello world",
      draftValue: "hello brave world",
    });

    expect(reconciliation.value).toBe("remote hello brave world");
    expect(reconciliation.localChanged).toBe(true);
    expect(reconciliation.remoteChanged).toBe(true);
    expect(reconciliation.edit?.index).toBe("remote hello ".length);
    expect(reconciliation.edit?.deleteLength).toBe(0);
    expect(reconciliation.edit?.insertText).toBe("brave ");
  });

  test("rebases a composition draft over the latest authoritative Y.Text", () => {
    const { doc, text } = createTitle("hello world");
    const baseValue = text.toString();
    doc.transact(() => {
      text.insert(0, "remote ");
    }, "remote-title");

    applyYTextInputReconciliation({
      text,
      baseValue,
      draftValue: "hello brave world",
      origin: "local-title",
    });

    expect(text.toString()).toBe("remote hello brave world");
  });

  test("preserves a remote insertion inside the locally replaced range", () => {
    const reconciliation = reconcileYTextInputValues({
      baseValue: "abcd",
      currentValue: "abXcd",
      draftValue: "ad",
    });

    expect(reconciliation.value).toBe("aXd");
    expect(reconciliation.edit?.index).toBe(1);
    expect(reconciliation.edit?.deleteLength).toBe(3);
    expect(reconciliation.edit?.insertText).toBe("X");
  });

  test("does not overwrite remote state when the local draft did not change", () => {
    const reconciliation = reconcileYTextInputValues({
      baseValue: "Base",
      currentValue: "Remote Base",
      draftValue: "Base",
    });

    expect(reconciliation.value).toBe("Remote Base");
    expect(reconciliation.edit).toBe(null);
    expect(reconciliation.localChanged).toBe(false);
    expect(reconciliation.remoteChanged).toBe(true);
  });

  test("enforces the canonical UTF-16 title limit before mutating Y.Text", () => {
    const { text } = createTitle("Safe");
    let error: unknown;

    try {
      applyYTextInputReconciliation({
        text,
        baseValue: "Safe",
        draftValue: `${"a".repeat(MAX_PAGE_TITLE_LENGTH - 1)}😀`,
        origin: "local-title",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof YTextInputReconciliationError).toBe(true);
    expect(text.toString()).toBe("Safe");
  });

  test("applies the edit in one transaction with the supplied origin", () => {
    const { doc, text } = createTitle("Before");
    const localOrigin = { surface: "title" };
    let observedOrigin: unknown;
    let observedTransactions = 0;
    doc.on("afterTransaction", (transaction) => {
      observedTransactions += 1;
      observedOrigin = transaction.origin;
    });

    const result = applyYTextInputReconciliation({
      text,
      baseValue: "Before",
      draftValue: "After",
      origin: localOrigin,
    });

    expect(result.value).toBe("After");
    expect(text.toString()).toBe("After");
    expect(observedTransactions).toBe(1);
    expect(observedOrigin).toBe(localOrigin);
  });

  test("tracked local undo leaves a remote title edit intact", () => {
    const { doc, text } = createTitle("Title");
    const localOrigin = { surface: "local-title" };
    const remoteOrigin = { surface: "remote-title" };
    const undoManager = new Y.UndoManager(text, {
      trackedOrigins: new Set([localOrigin]),
    });

    applyYTextInputReconciliation({
      text,
      baseValue: "Title",
      draftValue: "Title local",
      origin: localOrigin,
    });
    doc.transact(() => {
      text.insert(0, "Remote ");
    }, remoteOrigin);
    undoManager.undo();

    expect(text.toString()).toBe("Remote Title");
    undoManager.destroy();
  });
});
