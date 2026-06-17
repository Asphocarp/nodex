import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { render, settleAsyncRender, textContent } from "../../../test/dom";

afterEach(() => {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("toggle-")) keys.push(key);
  }
  for (const key of keys) {
    localStorage.removeItem(key);
  }
});

describe("readonly NFM BlockNote preview", () => {
  test("renders NFM content through the read-only BlockNote surface", async () => {
    const { ReadonlyNfmBlockNotePreview } = await import("./readonly-nfm-blocknote-preview");
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={"# Historical heading\n\nSnapshot body with **bold** text"}
        projectId="alpha"
        cardId="card-1"
        historyId={1}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("Historical heading")) {
        throw new Error("Heading not rendered");
      }
    });

    expect(textContent(view.container).includes("Snapshot body")).toBeTrue();
    expect(view.container.querySelector('[data-testid="readonly-nfm-blocknote-preview"]')).not.toBeNull();
    expect(view.container.querySelector('[contenteditable="true"]') === null).toBeTrue();
  });

  test("renders live embeds as inert placeholders", async () => {
    const { ReadonlyNfmBlockNotePreview } = await import("./readonly-nfm-blocknote-preview");
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={[
          '<card-ref project="alpha" card="card-1" />',
          '<thread-section label="Investigate" thread="thr_123" />',
          '<toggle-list-inline-view project="alpha" />',
        ].join("\n\n")}
        projectId="alpha"
        cardId="card-1"
        historyId={2}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("Card reference")) {
        throw new Error("Card reference placeholder not rendered");
      }
    });

    const body = textContent(view.container);
    expect(body.includes("Thread section")).toBeTrue();
    expect(body.includes("Toggle list view")).toBeTrue();
    expect(body.includes("Search cards")).toBeFalse();
    expect(body.includes("Rules")).toBeFalse();
  });

  test("renders attachment and agent config as inert chips", async () => {
    const { ReadonlyNfmBlockNotePreview } = await import("./readonly-nfm-blocknote-preview");
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={'Before <attachment kind="file" mode="link" source="/tmp/report.md" name="report.md" /> after\n\nUse <agent-config mode="plan" model="gpt-5.5" reasoning="high" />'}
        projectId="alpha"
        cardId="card-1"
        historyId={3}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("report.md")) {
        throw new Error("Attachment chip not rendered");
      }
    });

    const attachmentChip = Array.from(view.container.querySelectorAll("span"))
      .find((element) => textContent(element).includes("report.md"));
    expect(attachmentChip).not.toBeNull();
    if (!attachmentChip) return;

    fireEvent.click(attachmentChip);
    fireEvent.click(view.getByText("Plan mode"));
    await settleAsyncRender();

    expect(textContent(view.container).includes("Plan mode")).toBeTrue();
    expect(document.body.querySelector('[role="dialog"]') === null).toBeTrue();
    expect(document.body.querySelector('[data-radix-popper-content-wrapper]') === null).toBeTrue();
  });

  test("initializes and cleans preview toggle state", async () => {
    const { ReadonlyNfmBlockNotePreview } = await import("./readonly-nfm-blocknote-preview");
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={"▼ Open toggle\n\tOpen child\n\n▶ Closed toggle\n\tClosed child"}
        projectId="alpha"
        cardId="card-1"
        historyId={4}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("Open toggle")) {
        throw new Error("Toggle not rendered");
      }
    });

    const toggleKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("toggle-")) toggleKeys.push(key);
    }

    expect(toggleKeys.length).toBe(2);
    expect(toggleKeys.some((key) => localStorage.getItem(key) === "true")).toBeTrue();
    expect(toggleKeys.some((key) => localStorage.getItem(key) === "false")).toBeTrue();

    view.unmount();
    await settleAsyncRender();

    const remainingToggleKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("toggle-")) remainingToggleKeys.push(key);
    }
    expect(remainingToggleKeys.length).toBe(0);
  });
});
