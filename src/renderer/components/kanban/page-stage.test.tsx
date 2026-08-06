import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  writePageStageContentWidthPreference,
  writePageStageShowRawContentPreference,
} from "@/lib/page-stage-layout";
import type { DatabasePage } from "@/lib/types";
import {
  projectPageDetailToStageModel,
  type PageStagePageModel,
} from "@/lib/page-stage-page";
import { readPageStageSemanticProperties } from "@/lib/page-stage-properties";
import type { PageStageProps } from "./page-stage/types";
import {
  renderWithMaitai as render,
  settleAsyncRender,
  textContentIncludingShadowRoots,
} from "@/test/dom";
import {
  plainTextToPortableRichText,
} from "../../../shared/block-documents";
import { projectContentAccess } from "../../../shared/content-access-context";
import { buildPageDetailStoryResult } from "./page-stage/page-stage-story-page-detail";
import type { BlockRecordWindow } from "../../../shared/block-records";
import type { BlockRecordWindowStore } from "@/lib/block-record-window-store";

let lastNfmEditorProps: Record<string, unknown> | null = null;

vi.mock("./editor/nfm-editor", () => ({
  NfmEditor: (props: Record<string, unknown>) => {
    lastNfmEditorProps = props;
    return <div>Mock collaborative editor</div>;
  },
}));

vi.mock("@/components/block-documents/block-document-sync-status", () => ({
  BlockDocumentSyncStatus: () => null,
}));

vi.mock("./page-stage/inline-property-strip", () => ({
  PageStageInlinePropertyStrip: () => <div>Inline property strip</div>,
}));

vi.mock("./page-stage/properties-section", () => ({
  PageStagePropertiesSection: () => <div>Properties section</div>,
}));

function buildPage(overrides: Partial<DatabasePage> = {}): DatabasePage {
  const title = overrides.title ?? "Stale projected title";
  return {
    id: "page-1",
    status: "build",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    description: "Stale projected body",
    tags: [],
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function toStageModel(page: DatabasePage): PageStagePageModel {
  const detail = buildPageDetailStoryResult("default", page);
  if (!detail.ok) throw new Error(detail.error.message);
  const projected = projectPageDetailToStageModel(detail.value);
  if (projected.databaseContext.kind !== "member") return projected;
  const properties = projected.databaseContext.properties.filter((item) =>
    item.property.valueType !== "select"
    && item.property.valueType !== "multi_select");
  return {
    ...projected,
    databaseContext: {
      ...projected.databaseContext,
      properties,
      semanticProperties: readPageStageSemanticProperties(properties),
    },
  };
}

const recordWindow = (): BlockRecordWindow => ({
  libraryId: "library:default",
  rootParent: { kind: "block", blockId: "page-1" },
  viewId: null,
  records: [
    {
      id: "page-1",
      libraryId: "library:default",
      kind: "page",
      lifecycle: "active",
      properties: {},
      contentShardId: "shard:page-1",
      revision: 1,
    },
    {
      id: "body-1",
      libraryId: "library:default",
      kind: "paragraph",
      lifecycle: "active",
      properties: {},
      contentShardId: "shard:body-1",
      revision: 1,
    },
  ],
  placements: [
    {
      blockId: "page-1",
      parent: { kind: "library", libraryId: "library:default" },
      rankKey: "a",
      revision: 1,
    },
    {
      blockId: "body-1",
      parent: { kind: "block", blockId: "page-1" },
      rankKey: "a",
      revision: 1,
    },
  ],
  viewPositions: [],
  content: [
    {
      blockId: "page-1",
      slot: "title",
      content: [{ type: "text", text: "Live title", styles: {} }],
      shardId: "shard:page-1",
      head: 1,
    },
    {
      blockId: "body-1",
      slot: "inline",
      content: [{ type: "text", text: "Live record body", styles: {} }],
      shardId: "shard:body-1",
      head: 1,
    },
  ],
  observedLocalCommit: { storeEpoch: "store-1", commitSeq: 1 },
  continuation: null,
});

const createRecordWindowStore = (): BlockRecordWindowStore => {
  let snapshot: BlockRecordWindow | null = null;
  const listeners = new Set<(window: BlockRecordWindow) => void>();
  const publish = (next: BlockRecordWindow): void => {
    snapshot = next;
    listeners.forEach((listener) => listener(next));
  };
  return {
    getSnapshot: () => snapshot,
    read: async () => recordWindow(),
    load: async () => {
      const next = recordWindow();
      publish(next);
      return next;
    },
    apply: async () => {
      throw new Error("The PageStage test editor does not persist mutations");
    },
    applyCommit: () => null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startCommitSubscription: () => () => undefined,
  };
};

function renderStage(
  page: PageStagePageModel = toStageModel(buildPage()),
  titleCallbacks: Pick<PageStageProps, "onTitleChange" | "onTitleSourceDispose"> = {},
  breadcrumbProps: Pick<PageStageProps, "breadcrumb"> = {},
) {
  const { PageStage } = requirePageStage();
  return render(
    <NodexTooltipProvider>
      <PageStage
        contentAccessContext={projectContentAccess("default")}
        onClose={() => undefined}
        page={page}
        documentScopeId="default"
        projectName="Default"
        recordWindowStore={createRecordWindowStore()}
        onUpdate={async () => ({ status: "updated", didMutate: true })}
        onUpdateProperty={async () => ({ status: "updated", didMutate: true })}
        {...titleCallbacks}
        {...breadcrumbProps}
        {...(page.databaseContext.kind === "member"
          ? {
              onDelete: async () => undefined,
              onMove: async () => undefined,
            }
          : {})}
      />
    </NodexTooltipProvider>,
  );
}

let loadedPageStage: typeof import("./page-stage") | null = null;
function requirePageStage(): typeof import("./page-stage") {
  if (!loadedPageStage) throw new Error("Page Detail module has not loaded");
  return loadedPageStage;
}

describe("page stage", () => {
  beforeEach(async () => {
    localStorage.clear();
    lastNfmEditorProps = null;
    loadedPageStage = await import("./page-stage");
  });

  test("mounts the rich editor from the record-backed Page window", async () => {
    writePageStageContentWidthPreference(true);
    writePageStageShowRawContentPreference(false);
    const { container, getByText } = renderStage();
    await settleAsyncRender();

    expect(getByText("Mock collaborative editor").textContent).toBe(
      "Mock collaborative editor",
    );
    const source = lastNfmEditorProps?.source as Record<string, unknown>;
    expect(lastNfmEditorProps?.documentScopeId).toBe("default");
    expect(lastNfmEditorProps?.contentAccessContext).toEqual(
      projectContentAccess("default"),
    );
    expect(source.kind).toBe("record-window");
    expect(source.documentId).toBe("page-1");
    expect(Object.hasOwn(source, "initialContent")).toBe(true);
    expect(Object.hasOwn(source, "onDocumentChange")).toBe(true);
    expect(container.querySelector('[data-page-stage-heading-navigation-portal-target="true"]')).not.toBeNull();
  });

  test("publishes the canonical record title and disposes its live source", async () => {
    const onTitleChange = vi.fn();
    const onTitleSourceDispose = vi.fn();
    const view = renderStage(toStageModel(buildPage()), {
      onTitleChange,
      onTitleSourceDispose,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onTitleChange).toHaveBeenCalledWith("Live title");

    view.unmount();
    expect(onTitleSourceDispose).toHaveBeenCalledOnce();
  });

  test("renders the current breadcrumb item from the canonical title", async () => {
    const view = renderStage(toStageModel(buildPage()), {}, {
      breadcrumb: {
        ancestors: [{
          projectId: "default",
          pageId: "parent-page",
          title: "Parent Page",
        }],
        onOpenAncestor: () => undefined,
      },
    });

    await settleAsyncRender();
    await act(async () => {
      fireEvent.change(view.getByRole("textbox", { name: "Page title" }), {
        target: { value: "Renamed live title" },
      });
      await Promise.resolve();
    });

    const breadcrumb = view.getByRole("navigation", {
      name: "Page hierarchy",
    });
    expect(
      breadcrumb.querySelector('[aria-current="page"]')?.textContent,
    ).toBe("Renamed live title");
  });

  test("opens a standalone Page without Database controls or delete", async () => {
    const member = toStageModel(buildPage());
    const standalone: PageStagePageModel = {
      page: member.page,
      databaseContext: { kind: "standalone" },
    };
    const { getByRole, queryByText, queryByRole, getByText } = renderStage(standalone);

    expect(getByText("Mock collaborative editor")).toBeTruthy();
    expect(queryByText("Inline property strip")).toBeNull();

    fireEvent.pointerDown(getByRole("button", { name: "Page actions" }), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();

    expect(queryByRole("menuitem", { name: "Copy deeplink" })).toBeTruthy();
    expect(queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  test("copies the current Page deeplink from the actions menu", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      const { getByRole } = renderStage();

      fireEvent.pointerDown(getByRole("button", { name: "Page actions" }), {
        button: 0,
        ctrlKey: false,
      });
      await settleAsyncRender();

      fireEvent.click(getByRole("menuitem", { name: "Copy deeplink" }));
      await settleAsyncRender();

      expect(writeText).toHaveBeenCalledWith("nodex://pages/page-1");
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  test("raw mode reads the record-backed content projection", async () => {
    writePageStageShowRawContentPreference(true);
    const { findByLabelText, getByText, queryByText } = renderStage();

    expect(getByText("Raw format").textContent).toBe("Raw format");
    expect(queryByText("Mock collaborative editor")).toBe(null);
    const rawContent = await findByLabelText("Raw page source");
    await waitFor(() => {
      expect(textContentIncludingShadowRoots(rawContent).includes("Live record body")).toBe(true);
      expect(textContentIncludingShadowRoots(rawContent).includes("Stale projected body")).toBe(false);
    });
  });

  test("full width changes only the Page Detail presentation lane", async () => {
    writePageStageContentWidthPreference(true);
    writePageStageShowRawContentPreference(false);
    const { container, getByRole } = renderStage();
    const body = container.querySelector('[data-page-stage-body="true"]');
    const fullWidthButton = getByRole("button", { name: "Full width" });

    expect(body?.getAttribute("data-page-stage-body-width")).toBe("constrained");
    await act(async () => {
      (fullWidthButton as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(body?.getAttribute("data-page-stage-body-width")).toBe("full");
  });
});
