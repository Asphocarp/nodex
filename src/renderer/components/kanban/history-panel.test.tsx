import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { HistoryCardVersionPreview, HistoryPanelEntry } from "../../../shared/ipc-api";
import type { Card } from "../../../shared/types";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import * as HistoryPanelDeps from "./history-panel-deps";

mock.module("./history-panel-deps", () => ({
  ...HistoryPanelDeps,
  TAB_BAR_HEIGHT: 48,
  ARCHIVED_CARD_OPTION_ID: "archived",
  ARCHIVED_CARD_OPTION_NAME: "Archived",
  EMPTY_PRIORITY_OPTION_VALUE: "none",
  KANBAN_STATUS_OPTIONS: [
    { id: "draft", name: "Draft" },
    { id: "in_progress", name: "In progress" },
  ],
  KANBAN_STATUS_LABELS: {
    draft: "Draft",
    in_progress: "In progress",
  },
  invoke: async (...args: unknown[]) => {
    const handler = (globalThis as {
      __historyPanelInvoke?: (...invokeArgs: unknown[]) => Promise<unknown> | unknown;
    }).__historyPanelInvoke;
    return handler ? await handler(...args) : { entries: [] };
  },
  subscribeGitBranchChanges: () => () => undefined,
  useTheme: () => ({ resolved: "light" as const }),
  FileDiff: ({ className }: { className?: string }) => createElement("div", { className, "data-file-diff": "true" }),
  MultiFileDiff: ({
    oldFile,
    newFile,
    className,
  }: {
    oldFile: { contents: string };
    newFile: { contents: string };
    className?: string;
  }) => createElement("div", { className, "data-diff": "true" }, `${oldFile.contents} => ${newFile.contents}`),
  PatchDiff: ({ className }: { className?: string }) => createElement("div", { className, "data-patch-diff": "true" }),
}));

afterEach(() => {
  delete (globalThis as { __historyPanelInvoke?: unknown }).__historyPanelInvoke;
});

describe("history panel", () => {
  test("renders block-level description deltas in the details view", async () => {
    const { HistoryEntryDetails } = await import("./history-panel");
    const entry: HistoryPanelEntry = {
      id: 11,
      projectId: "default",
      operation: "update",
      cardId: "card-1",
      status: "draft",
      archived: false,
      timestamp: "2026-03-12T12:00:00.000Z",
      sessionId: null,
      groupId: null,
      isUndone: false,
      undoOf: null,
      summary: "Description + 1 field",
      fieldChanges: [
        {
          field: "tags",
          before: [],
          after: ["delta"],
        },
      ],
      move: null,
      descriptionChange: {
        beforeBlockCount: 2,
        afterBlockCount: 3,
        beforeFullText: "# Heading\n\nAlpha paragraph",
        afterFullText: "# Heading\n\nBeta paragraph\n\nGamma paragraph",
        blocks: [
          {
            changeType: "replaced",
            blockType: "paragraph",
            beforeOrdinal: 1,
            afterOrdinal: 1,
            beforePreview: "Alpha paragraph",
            afterPreview: "Beta paragraph",
            beforeNfm: "Alpha paragraph",
            afterNfm: "Beta paragraph",
          },
          {
            changeType: "added",
            blockType: "paragraph",
            beforeOrdinal: null,
            afterOrdinal: 2,
            beforePreview: null,
            afterPreview: "Gamma paragraph",
            beforeNfm: null,
            afterNfm: "Gamma paragraph",
          },
        ],
      },
      snapshot: null,
    };

    const { container, getByText } = render(
      <HistoryEntryDetails
        entry={entry}
        selectedIndex={0}
        totalCount={1}
        onNavigate={() => undefined}
        onRevert={() => undefined}
        onRestore={() => undefined}
        actionInFlight={null}
        confirmingAction={null}
        onRequestConfirm={() => undefined}
        onCancelConfirm={() => undefined}
        actionError={null}
      />,
    );

    expect(getByText("Description").textContent).toBe("Description");
    expect(textContent(container).includes("Alpha paragraph")).toBeTrue();
    expect(textContent(container).includes("Gamma paragraph")).toBeTrue();
    expect(container.querySelectorAll("summary").length > 0).toBeTrue();
    expect(getByText("Full description diff").textContent).toBe("Full description diff");
    expect(getByText("Tags").textContent).toBe("Tags");
  });

  test("renders the shared diff viewer when the full description diff is expanded", async () => {
    const { DescriptionFullDiffDisclosure } = await import("./history-panel");

    const { container } = render(
      <DescriptionFullDiffDisclosure
        beforeText="Alpha paragraph"
        afterText="Beta paragraph"
        defaultOpen
      />,
    );

    expect(container.querySelector('[data-diff="true"]')).not.toBeNull();
    expect(textContent(container).includes("Alpha paragraph => Beta paragraph")).toBeTrue();
    expect(container.innerHTML.includes("nodex-inline-diff")).toBeTrue();
  });

  test("renders the version-history modal with a reconstructed preview and actions", async () => {
    const { HistoryPanel } = await import("./history-panel");
    const entries = [makeHistoryPanelEntry(2, "update"), makeHistoryPanelEntry(1, "create")];
    const preview = makeHistoryPreview(2, {
      title: "Snapshot title",
      description: "Snapshot body",
      tags: ["ui", "history"],
    });
    let restoredHistoryId: number | null = null;
    let revertedHistoryId: number | null = null;

    (globalThis as { __historyPanelInvoke?: (...invokeArgs: unknown[]) => Promise<unknown> | unknown }).__historyPanelInvoke = (
      channel,
      _projectId,
      _cardIdOrHistoryId,
      maybeHistoryId,
    ) => {
      if (channel === "history:card") return { entries };
      if (channel === "history:card-version-preview") return { preview };
      if (channel === "history:restore") {
        restoredHistoryId = Number(maybeHistoryId);
        return { success: true };
      }
      if (channel === "history:revert") {
        revertedHistoryId = Number(_cardIdOrHistoryId);
        return { success: true };
      }
      return {};
    };

    const { getByRole } = render(
      <HistoryPanel
        projectId="alpha"
        cardId="card-1"
        cardTitle="Current title"
        projectWorkspacePath="/workspace/alpha"
        open
        onClose={() => undefined}
      />,
    );
    await settleAsyncRender();
    await waitFor(() => {
      if (!textContent(document.body).includes("Snapshot title")) {
        throw new Error("Preview not loaded");
      }
    });

    expect(document.body.querySelector('[role="dialog"]') !== null).toBeTrue();
    expect(textContent(document.body).includes("Version history")).toBeTrue();
    expect(textContent(document.body).includes("Snapshot body")).toBeTrue();
    expect(textContent(document.body).includes("ui, history")).toBeTrue();
    const previewNode = document.body.querySelector('[data-testid="readonly-nfm-blocknote-preview"]');
    expect(previewNode).not.toBeNull();
    if (!(previewNode instanceof HTMLElement)) return;
    expect(previewNode.dataset.projectId).toBe("alpha");
    expect(previewNode.dataset.cardId).toBe("card-1");
    expect(previewNode.dataset.historyId).toBe("2");
    expect(previewNode.dataset.projectWorkspacePath).toBe("/workspace/alpha");

    fireEvent.click(getByRole("button", { name: "Restore" }));
    expect(textContent(document.body).includes("Confirm restore")).toBeTrue();
    fireEvent.click(getByRole("button", { name: "Confirm restore" }));
    await settleAsyncRender();
    expect(restoredHistoryId).toBe(2);

    fireEvent.click(getByRole("button", { name: "Revert update" }));
    fireEvent.click(getByRole("button", { name: "Confirm" }));
    await settleAsyncRender();
    expect(revertedHistoryId).toBe(2);
  });

  test("shows preview load errors inside the modal", async () => {
    const { HistoryPanel } = await import("./history-panel");
    const entries = [makeHistoryPanelEntry(3, "update")];
    (globalThis as { __historyPanelInvoke?: (...invokeArgs: unknown[]) => Promise<unknown> | unknown }).__historyPanelInvoke = (
      channel,
    ) => {
      if (channel === "history:card") return { entries };
      if (channel === "history:card-version-preview") {
        return { preview: null, error: "Cannot reconstruct state" };
      }
      return {};
    };

    render(
      <HistoryPanel
        projectId="alpha"
        cardId="card-1"
        open
        onClose={() => undefined}
      />,
    );
    await settleAsyncRender();
    await waitFor(() => {
      if (!textContent(document.body).includes("Cannot reconstruct state")) {
        throw new Error("Preview error not rendered");
      }
    });

    expect(textContent(document.body).includes("Cannot reconstruct state")).toBeTrue();
  });
});

function makeHistoryPanelEntry(
  id: number,
  operation: HistoryPanelEntry["operation"],
): HistoryPanelEntry {
  return {
    id,
    projectId: "alpha",
    operation,
    cardId: "card-1",
    status: "draft",
    archived: false,
    timestamp: `2026-06-18T0${id}:00:00.000Z`,
    sessionId: null,
    groupId: null,
    isUndone: false,
    undoOf: null,
    summary: operation === "update" ? "Updated title" : "Created card",
    fieldChanges: operation === "update"
      ? [{ field: "title", before: "Old", after: "New" }]
      : [],
    move: null,
    descriptionChange: null,
    snapshot: null,
  };
}

function makeHistoryPreview(
  historyId: number,
  cardOverrides: Partial<Card>,
): HistoryCardVersionPreview {
  return {
    historyId,
    projectId: "alpha",
    cardId: "card-1",
    card: {
      id: "card-1",
      status: "draft",
      archived: false,
      title: "Snapshot title",
      description: "Snapshot body",
      tags: [],
      agentBlocked: false,
      created: new Date("2026-06-18T00:00:00.000Z"),
      order: 0,
      ...cardOverrides,
    },
  };
}
