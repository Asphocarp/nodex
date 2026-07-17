import { act, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useEffect, type ReactNode } from "react";

import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  writePageStageContentWidthPreference,
  writePageStageShowRawContentPreference,
} from "@/lib/page-stage-layout";
import type { DatabasePage } from "@/lib/types";
import type { PageStagePageModel } from "@/lib/page-stage-page";
import type { PageStageProps } from "./page-stage/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import {
  PAGE_DOCUMENT_SCHEMA_VERSION,
  createPageDocument,
  plainTextToPortableRichText,
} from "../../../shared/block-documents";
import { populateBlockDocumentBodyFromNfm } from "../../../shared/block-documents/block-document-codec";

let lastNfmEditorProps: Record<string, unknown> | null = null;
let publishCollaborativeTitle: ((title: string) => void) | null = null;
let surfaceDocument = createPageDocument({
  documentId: "document:page-1",
  initialTitle: "Live title",
});

vi.mock("./editor/nfm-editor", () => ({
  NfmEditor: (props: Record<string, unknown>) => {
    lastNfmEditorProps = props;
    return <div>Mock collaborative editor</div>;
  },
}));

vi.mock("@/components/block-documents/block-document-sync-status", () => ({
  BlockDocumentSyncStatus: () => null,
}));

vi.mock("@/components/block-documents/collaborative-page-title", () => ({
  CollaborativePageTitle: ({
    onValueChange,
  }: {
    onValueChange?: (title: string) => void;
  }) => {
    publishCollaborativeTitle = onValueChange ?? null;
    useEffect(() => {
      onValueChange?.("Live title");
    }, [onValueChange]);
    return <div>Live title</div>;
  },
}));

vi.mock("@/components/block-documents/block-document-surface", () => ({
  BlockDocumentSurface: (props: {
    descriptor: Record<string, unknown>;
    runtimeRef?: { current: unknown };
    children: (surface: Record<string, unknown>) => ReactNode;
  }) => {
    const runtime = {
      descriptor: props.descriptor,
      clientSessionId: "surface-1",
      persist: async () => undefined,
      getStatus: () => ({ reloadRequired: false }),
    };
    if (props.runtimeRef) props.runtimeRef.current = runtime;
    return props.children({
      ...surfaceDocument,
      descriptor: props.descriptor,
      runtime,
      awareness: {},
      status: { provider: { phase: "synced" } },
    });
  },
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
  return {
    page: {
      id: page.id,
      archived: page.archived,
      title: page.title,
      richTitle: page.richTitle,
      isAllDay: Boolean(page.isAllDay),
      reminders: page.reminders ?? [],
      revision: page.revision ?? 1,
      created: page.created,
    },
    databaseContext: {
      kind: "member",
      membership: {
        id: "membership-1",
        dataSourceId: "source-1",
        databaseId: "database-1",
        revision: 1,
      },
      compatibilityProperties: {
        status: page.status,
        tags: page.tags,
      },
    },
  };
}

function documentAuthority() {
  return {
    kind: "yjs" as const,
    descriptor: {
      projectId: "default",
      ownerBlockId: "page-1",
      ownerType: "page" as const,
      ownerLifecycle: "active" as const,
      documentId: "document:page-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.page" as const,
      schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION as 2,
      readiness: "ready" as const,
      sync: { kind: "yjs" as const, stateVector: new Uint8Array() },
    },
    reload: async () => undefined,
  };
}

function renderStage(
  page: PageStagePageModel = toStageModel(buildPage()),
  titleCallbacks: Pick<PageStageProps, "onTitleChange" | "onTitleSourceDispose"> = {},
  breadcrumbProps: Pick<PageStageProps, "breadcrumb"> = {},
) {
  const { PageStage } = requirePageStage();
  return render(
    <NodexTooltipProvider>
      <PageStage
        onClose={() => undefined}
        page={page}
        projectId="default"
        projectName="Default"
        documentAuthority={documentAuthority()}
        availableTags={[]}
        onUpdate={async () => ({ status: "updated", didMutate: true })}
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
    publishCollaborativeTitle = null;
    surfaceDocument.document.destroy();
    surfaceDocument = createPageDocument({
      documentId: "document:page-1",
      initialTitle: "Live title",
    });
    populateBlockDocumentBodyFromNfm(
      surfaceDocument.body,
      "# Live collaborative body\n\n- item",
    );
    loadedPageStage = await import("./page-stage");
  });

  test("mounts the rich editor only from the collaborative Document source", () => {
    writePageStageContentWidthPreference(true);
    writePageStageShowRawContentPreference(false);
    const { container, getByText } = renderStage();

    expect(getByText("Mock collaborative editor").textContent).toBe(
      "Mock collaborative editor",
    );
    const source = lastNfmEditorProps?.source as Record<string, unknown>;
    expect(source.kind).toBe("collaborative-document");
    expect(source.documentId).toBe("document:page-1");
    expect(Object.hasOwn(source, "content")).toBe(false);
    expect(Object.hasOwn(source, "onChange")).toBe(false);
    expect(container.querySelector('[data-page-stage-heading-navigation-portal-target="true"]')).not.toBeNull();
  });

  test("publishes the initial Y.Text title and disposes its live source", async () => {
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

  test("renders the current breadcrumb item from the live Y.Text title", async () => {
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
      publishCollaborativeTitle?.("Renamed live title");
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

  test("raw mode reads the live Y.Doc projection, not the Page row projection", () => {
    writePageStageShowRawContentPreference(true);
    const { container, getByText, queryByText } = renderStage();

    expect(getByText("Raw format").textContent).toBe("Raw format");
    expect(queryByText("Mock collaborative editor")).toBe(null);
    expect(textContent(container).includes("Live collaborative body")).toBe(true);
    expect(textContent(container).includes("Stale projected body")).toBe(false);
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
