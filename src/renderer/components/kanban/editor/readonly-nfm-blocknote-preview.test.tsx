import { afterEach, describe, expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import {
  createDateMentionClockStore,
  setDateMentionClockStoreForTest,
} from "@/lib/nfm/date-mention-clock";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import { ReadonlyNfmBlockNotePreview } from "./readonly-nfm-blocknote-preview";

let restoreDateMentionClockStore: (() => void) | null = null;

afterEach(() => {
  restoreDateMentionClockStore?.();
  restoreDateMentionClockStore = null;

  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("toggle-")) keys.push(key);
  }
  for (const key of keys) {
    localStorage.removeItem(key);
  }
});

function installDateMentionClock(start: string) {
  let currentNow = new Date(start);
  const store = createDateMentionClockStore({
    now: () => new Date(currentNow.getTime()),
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  restoreDateMentionClockStore = setDateMentionClockStoreForTest(store);

  return {
    store,
    setNow: (value: string) => {
      currentNow = new Date(value);
    },
  };
}

describe("readonly NFM BlockNote preview", () => {
  test("renders NFM content through the read-only BlockNote surface", async () => {
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={"# Historical heading\n\nSnapshot body with **bold** text"}
        projectId="alpha"
        pageId="card-1"
        historyId={1}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("Historical heading")) {
        throw new Error("Heading not rendered");
      }
    });

    expect(textContent(view.container).includes("Snapshot body")).toBe(true);
    expect(view.container.querySelector('[data-testid="readonly-nfm-blocknote-preview"]')).not.toBeNull();
    expect(view.container.querySelector('[contenteditable="true"]') === null).toBe(true);
  });

  test("renders live embeds as inert placeholders", async () => {
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={[
          '<card-ref project="alpha" card="card-1" />',
          '<thread-section label="Investigate" thread="thr_123" />',
          '<toggle-list-inline-view project="alpha" />',
        ].join("\n\n")}
        projectId="alpha"
        pageId="card-1"
        historyId={2}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("Page mention")) {
        throw new Error("Page mention placeholder not rendered");
      }
    });

    const body = textContent(view.container);
    expect(body.includes("Thread section")).toBe(true);
    expect(body.includes("Toggle list view")).toBe(true);
    expect(body.includes("Search Pages")).toBe(false);
    expect(body.includes("Rules")).toBe(false);
  });

  test("renders attachment, agent config, and thread mention as inert inline content", async () => {
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={'Before <attachment kind="file" mode="link" source="/tmp/report.md" name="report.md" /> after\n\nUse <agent-config mode="plan" model="gpt-5.5" reasoning="high" />\n\nSee <mention-thread uuid="019-thread" />'}
        projectId="alpha"
        pageId="card-1"
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

    expect(textContent(view.container).includes("Plan mode")).toBe(true);
    expect(textContent(view.container).includes("019-thread")).toBe(true);
    expect(document.body.querySelector('[role="dialog"]') === null).toBe(true);
    expect(document.body.querySelector('[data-radix-popper-content-wrapper]') === null).toBe(true);
  });

  test("refreshes readonly date mention labels while mounted", async () => {
    const clock = installDateMentionClock("2026-06-28T12:00:00");
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={'Readonly note with <mention-date start="2026-06-28" format="relative" />.'}
        projectId="alpha"
        pageId="card-1"
        historyId={5}
      />,
    );

    await waitFor(() => {
      if (!textContent(view.container).includes("@Today")) {
        throw new Error("Date mention did not render as Today");
      }
    });

    await act(async () => {
      clock.setNow("2026-06-29T00:00:02");
      clock.store.refresh();
      await Promise.resolve();
    });

    await waitFor(() => {
      if (!textContent(view.container).includes("@Yesterday")) {
        throw new Error("Date mention did not refresh to Yesterday");
      }
    });
  });

  test("initializes and cleans preview toggle state", async () => {
    const view = render(
      <ReadonlyNfmBlockNotePreview
        content={"▼ Open toggle\n\tOpen child\n\n▶ Closed toggle\n\tClosed child"}
        projectId="alpha"
        pageId="card-1"
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
    expect(toggleKeys.some((key) => localStorage.getItem(key) === "true")).toBe(true);
    expect(toggleKeys.some((key) => localStorage.getItem(key) === "false")).toBe(true);

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
