import { describe, expect, vi, test } from "vitest";
import { act, createElement } from "react";
import { resetPageDraftStoreForTest, setPageDraftOverlay } from "../../lib/page-draft-store";
import type { CardPropertyPosition } from "@/lib/card-property-position";
import { render, textContent } from "../../test/dom";
import { PageTitleProjectionProvider } from "../../lib/page-title-projection-context";
import {
  createPageTitleProjectionStore,
  makePageTitleResourceKey,
} from "../../lib/page-title-projection-store";
import { plainTextToPortableRichText } from "../../../shared/block-documents/portable-rich-text";

let mockCardPropertyPosition: CardPropertyPosition = "inline";

vi.mock("./card-deps", () => ({
  useCardPropertyPosition: () => ({ position: mockCardPropertyPosition }),
}));

vi.mock("@/lib/use-theme", () => ({
  useTheme: () => ({ resolved: "light" as const }),
}));

vi.mock("@/lib/nfm/extract-text", () => ({
  extractPlainText: (value: string) => value,
}));

vi.mock("./editor/chip-property-editor", () => ({
  ChipPropertyEditor: () => null,
}));

vi.mock("./card-context-menu", () => ({
  CardContextMenu: ({ children }: { children: unknown }) => children,
}));

async function renderCard(props: Record<string, unknown>) {
  const { Card } = await import("./card");
  const typedProps = props as unknown as Parameters<typeof Card>[0];
  return render(createElement(Card, typedProps));
}

describe("board card", () => {
  test("places an enabled Page key above the card title and Properties", async () => {
    mockCardPropertyPosition = "top";
    const card = await renderCard({
      card: {
        id: "card-keyed",
        pageKey: "LAB-13",
        status: "build",
        archived: false,
        title: "Ship the keyed Board",
        description: "",
        priority: "p2-medium",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      showPageKey: true,
      onClick: () => undefined,
    });

    const pageKey = card.container.querySelector('[data-page-key="LAB-13"]');
    expect(pageKey?.nextElementSibling?.textContent).toBe("Ship the keyed Board");
    expect(pageKey?.parentElement?.nextElementSibling?.textContent).toContain("P2");
  });

  test("renders live title draft overlay for the matching project card", async () => {
    resetPageDraftStoreForTest();
    setPageDraftOverlay("default", "card-1", { title: "Draft title" });
    const card = await renderCard({
      projectId: "default",
      card: {
        id: "card-1",
        status: "build",
        archived: false,
        title: "Task",
        description: "Persisted body",
        priority: "p2-medium",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      onClick: () => undefined,
    });

    expect(textContent(card.container).includes("Draft title")).toBe(true);
    expect(textContent(card.container).includes("Task")).toBe(false);
  });

  test("projects an open Page editor title into the Board card immediately", async () => {
    const { Card } = await import("./card");
    const titleStore = createPageTitleProjectionStore();
    const card = render(
      <PageTitleProjectionProvider
        currentLibraryId="library-1"
        store={titleStore}
      >
        <Card
          card={{
            id: "card-live-title",
            pageKey: null,
            status: "build",
            archived: false,
            title: "Persisted title",
            richTitle: plainTextToPortableRichText("Persisted title"),
            descriptionPreview: "",
            descriptionLength: 0,
            hasDescription: false,
            tags: [],
            created: new Date("2026-03-01T00:00:00.000Z"),
            order: 0,
          }}
          columnId="build"
          onClick={() => undefined}
        />
      </PageTitleProjectionProvider>,
    );

    await act(async () => {
      titleStore.publishLive(
        makePageTitleResourceKey("library-1", "card-live-title"),
        "page-stage",
        "Live editor title",
      );
      await Promise.resolve();
    });

    expect(textContent(card.container).includes("Live editor title")).toBe(true);
    expect(textContent(card.container).includes("Persisted title")).toBe(false);
  });

  test("suppresses browser text selection on the card surface", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-1",
        status: "build",
        archived: false,
        title: "Task",
        description: "Body",
        priority: "p2-medium",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      onClick: () => undefined,
    });

    expect(card.container.querySelector(".select-none")).not.toBeNull();
  });

  test("renders presence independently when the Page is open in a visible panel", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-1",
        status: "build",
        archived: false,
        title: "Task",
        description: "Body",
        priority: "p2-medium",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      isPresented: true,
      isSelected: true,
      onClick: () => undefined,
    });

    const surface = card.container.querySelector<HTMLElement>('[data-board-card-presented="true"]');
    expect(surface).not.toBeNull();
    expect(surface?.querySelector('[data-page-presence-rail="true"]')).not.toBeNull();
  });

  test("renders property chips as buttons when inline editing is enabled", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-2",
        status: "build",
        archived: false,
        title: "Task",
        description: "Body",
        priority: "p2-medium",
        estimate: "m",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      onClick: () => undefined,
      onUpdateProperty: () => undefined,
    });

    expect(card.getByLabelText("Edit priority").getAttribute("aria-label")).toBe("Edit priority");
    expect(card.getByLabelText("Edit estimate").getAttribute("aria-label")).toBe("Edit estimate");
  });

  test("renders property chips inline inside the title when inline layout is selected", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-inline",
        status: "build",
        archived: false,
        title: "Task",
        description: "Body",
        priority: "p2-medium",
        estimate: "m",
        tags: ["o_AAAAAAAA"],
        assignee: "alex",
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      onClick: () => undefined,
      onUpdateProperty: () => undefined,
    });

    const heading = card.container.querySelector("h3");
    const priorityChip = card.getByLabelText("Edit priority");
    const estimateChip = card.getByLabelText("Edit estimate");
    const assignee = Array.from(heading?.querySelectorAll("span") ?? []).find((node) => node.textContent === "@alex");
    const title = Array.from(heading?.querySelectorAll("span") ?? []).find((node) => node.textContent === "Task");

    expect(heading).not.toBeNull();
    expect(assignee).not.toBeNull();
    expect(title).not.toBeNull();
    expect(Boolean(priorityChip.compareDocumentPosition(title as Node) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(estimateChip.compareDocumentPosition(title as Node) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  test("respects board display prefs for property order and visibility", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-display",
        status: "build",
        archived: false,
        title: "Task",
        description: "Body",
        priority: "p2-medium",
        estimate: "m",
        tags: ["o_AAAAAAAA"],
        assignee: "alex",
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      tagOptions: [{ id: "o_AAAAAAAA", name: "UI", color: "blue" }],
      displayPrefs: {
        propertyOrder: ["assignee", "tags", "estimate", "priority"],
        hiddenProperties: ["priority"],
        showEmptyEstimate: false,
        showEmptyPriority: false,
      },
      onClick: () => undefined,
      onUpdateProperty: () => undefined,
    });

    const heading = card.container.querySelector("h3");
    const assignee = Array.from(heading?.querySelectorAll("span") ?? []).find((node) => node.textContent === "@alex");
    const tag = Array.from(heading?.querySelectorAll("span") ?? []).find((node) => node.textContent === "UI");

    expect(assignee).not.toBeNull();
    expect(tag).not.toBeNull();
    expect(card.getByLabelText("Edit estimate").getAttribute("aria-label")).toBe("Edit estimate");
    expect(card.queryByLabelText("Edit priority") === null).toBe(true);
    expect(Boolean((assignee as Node).compareDocumentPosition(tag as Node) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  test("shows editable empty board priority and estimate placeholders when display prefs enable them", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-empty-display",
        status: "build",
        archived: false,
        title: "Task",
        description: "",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      displayPrefs: {
        propertyOrder: ["priority", "estimate", "tags", "assignee"],
        hiddenProperties: [],
        showEmptyEstimate: true,
        showEmptyPriority: true,
      },
      onClick: () => undefined,
      onUpdateProperty: () => undefined,
    });

    expect(card.getAllByText("-").length).toBe(2);
    expect(card.getByLabelText("Edit priority").getAttribute("aria-label")).toBe("Edit priority");
    expect(card.getByLabelText("Edit estimate").getAttribute("aria-label")).toBe("Edit estimate");
  });

  test("marks the card surface as a context-menu trigger when card actions are enabled", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-3",
        status: "build",
        archived: false,
        title: "Task",
        description: "",
        priority: "p2-medium",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      onClick: () => undefined,
      contextMenu: {
        currentColumnId: "build",
        currentProjectId: "default",
        currentProjectName: "Default",
        onDelete: () => undefined,
        onCopyLink: () => undefined,
      },
    });

    expect(card.container.querySelector('[data-card-context-menu-trigger="true"]')).not.toBeNull();
  });

  test("omits the priority chip when the card has no priority", async () => {
    mockCardPropertyPosition = "inline";
    const card = await renderCard({
      card: {
        id: "card-no-priority",
        status: "build",
        archived: false,
        title: "Task",
        description: "",
        tags: [],
        created: new Date("2026-03-01T00:00:00.000Z"),
        order: 0,
      },
      columnId: "build",
      onClick: () => undefined,
      onUpdateProperty: () => undefined,
    });

    expect(card.queryByLabelText("Edit priority") === null).toBe(true);
  });
});
