import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { render } from "@/test/dom";
import { CollaborativeCardTitle } from "./collaborative-card-title";
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
  initialValue: string,
): { readonly document: Y.Doc; readonly title: Y.Text } => {
  const document = new Y.Doc({ guid: "document:title-test" });
  const title = document.getText("title");
  if (initialValue.length > 0) title.insert(0, initialValue);
  return { document, title };
};

describe("CollaborativeCardTitle", () => {
  test("writes a local input as a minimal Y.Text transaction and reports authoritative changes", async () => {
    const { document, title } = createTitle("Card alpha");
    const reportedValues: string[] = [];
    const observedDeltas: string[] = [];
    title.observe((event) => {
      observedDeltas.push(JSON.stringify(event.delta));
    });

    const view = render(
      <CollaborativeCardTitle
        title={title}
        onValueChange={(value) => reportedValues.push(value)}
      />,
    );
    const input = view.getByRole("textbox", { name: "Card title" });

    await act(async () => {
      fireEvent.input(input, { target: { value: "Card beta" } });
      await Promise.resolve();
    });

    expect(title.toString()).toBe("Card beta");
    expect(observedDeltas.length).toBe(1);
    expect(observedDeltas[0]).toBe(
      JSON.stringify([
        { retain: 5 },
        { delete: 4 },
        { insert: "bet" },
      ]),
    );
    expect(reportedValues.join(",")).toBe("Card alpha,Card beta");

    await act(async () => {
      document.transact(() => title.insert(0, "Remote "), "remote");
      await Promise.resolve();
    });
    expect((input as HTMLTextAreaElement).value).toBe("Remote Card beta");
    expect(reportedValues.join(",")).toBe(
      "Card alpha,Card beta,Remote Card beta",
    );
    document.destroy();
  });

  test("rebases an IME draft over remote edits without replacing either intent", async () => {
    const { document, title } = createTitle("hello world");
    const view = render(<CollaborativeCardTitle title={title} />);
    const input = view.getByRole("textbox", {
      name: "Card title",
    }) as HTMLTextAreaElement;
    input.focus();

    await act(async () => {
      fireEvent.input(input, {
        target: { value: "hello brave world" },
        isComposing: true,
      });
      await Promise.resolve();
    });
    input.setSelectionRange(17, 17);

    await act(async () => {
      document.transact(() => title.insert(0, "remote "), "remote");
      await Promise.resolve();
    });

    expect(input.value).toBe("hello brave world");
    expect(title.toString()).toBe("remote hello world");

    await act(async () => {
      fireEvent.input(input, {
        target: { value: "hello brave world" },
        isComposing: false,
      });
      await Promise.resolve();
    });

    expect(title.toString()).toBe("remote hello brave world");
    expect(input.value).toBe("remote hello brave world");
    expect(input.selectionStart).toBe(24);
    expect(input.selectionEnd).toBe(24);
    document.destroy();
  });

  test("does not let an external Enter handler cancel an active IME composition", async () => {
    const { document, title } = createTitle("Card");
    let forwardedKeyDownCount = 0;
    const view = render(
      <CollaborativeCardTitle
        title={title}
        onKeyDown={(event) => {
          forwardedKeyDownCount += 1;
          if (event.key === "Enter") event.preventDefault();
        }}
      />,
    );
    const input = view.getByRole("textbox", {
      name: "Card title",
    }) as HTMLTextAreaElement;
    let wasNotCancelled = false;

    await act(async () => {
      fireEvent.compositionStart(input);
      wasNotCancelled = fireEvent.keyDown(input, {
        key: "Enter",
        isComposing: true,
      });
      await Promise.resolve();
    });

    expect(wasNotCancelled).toBeTrue();
    expect(forwardedKeyDownCount).toBe(0);
    document.destroy();
  });

  test("local undo preserves a later remote title edit", async () => {
    const { document, title } = createTitle("Title");
    const view = render(<CollaborativeCardTitle title={title} />);
    const input = view.getByRole("textbox", {
      name: "Card title",
    }) as HTMLTextAreaElement;
    input.focus();

    await act(async () => {
      fireEvent.input(input, { target: { value: "Title local" } });
      document.transact(() => title.insert(0, "Remote "), "remote");
      await Promise.resolve();
    });
    expect(input.value).toBe("Remote Title local");

    await act(async () => {
      fireEvent.keyDown(input, { key: "z", metaKey: true });
      await Promise.resolve();
    });

    expect(title.toString()).toBe("Remote Title");
    expect(input.value).toBe("Remote Title");
    document.destroy();
  });

  test("preserves a focused selection through a remote insertion", async () => {
    const { document, title } = createTitle("Hello world");
    const externalRef: { current: HTMLTextAreaElement | null } = {
      current: null,
    };
    const view = render(
      <CollaborativeCardTitle title={title} ref={externalRef} />,
    );
    const input = view.getByRole("textbox", {
      name: "Card title",
    }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(6, 11, "forward");

    await act(async () => {
      document.transact(() => title.insert(0, "Remote "), "remote");
      await Promise.resolve();
    });

    expect(externalRef.current === input).toBeTrue();
    expect(input.value).toBe("Remote Hello world");
    expect(input.selectionStart).toBe(13);
    expect(input.selectionEnd).toBe(18);
    document.destroy();
  });

  test("commits its own IME draft and freezes without blurring another surface", async () => {
    const first = createTitle("First");
    const second = createTitle("Second");
    const firstFence = new TestSurfaceWriteFence();
    const secondFence = new TestSurfaceWriteFence();
    const view = render(
      <>
        <CollaborativeCardTitle
          title={first.title}
          aria-label="First title"
          surfaceWriteFence={firstFence}
        />
        <CollaborativeCardTitle
          title={second.title}
          aria-label="Second title"
          surfaceWriteFence={secondFence}
        />
      </>,
    );
    const firstInput = view.getByRole("textbox", {
      name: "First title",
    }) as HTMLTextAreaElement;
    const secondInput = view.getByRole("textbox", {
      name: "Second title",
    }) as HTMLTextAreaElement;
    firstInput.focus();
    await act(async () => {
      fireEvent.compositionStart(firstInput);
      fireEvent.input(firstInput, {
        target: { value: "First draft" },
        isComposing: true,
      });
      firstFence.setFrozen(true);
      await firstFence.prepare();
    });

    expect(first.title.toString()).toBe("First draft");
    expect(firstInput.disabled).toBeTrue();
    expect(firstInput.ownerDocument.activeElement === firstInput).toBeFalse();

    secondInput.focus();
    await act(async () => {
      await firstFence.prepare();
    });
    expect(secondInput.ownerDocument.activeElement === secondInput).toBeTrue();
    await act(async () => {
      firstFence.setFrozen(false);
      await Promise.resolve();
    });
    expect(firstInput.disabled).toBeFalse();
    first.document.destroy();
    second.document.destroy();
  });
});
