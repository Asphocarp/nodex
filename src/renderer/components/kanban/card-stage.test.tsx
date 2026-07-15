import { act } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useEffect, type ReactNode } from "react";

import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  writeCardStageContentWidthPreference,
  writeCardStageShowRawContentPreference,
} from "@/lib/card-stage-layout";
import type { Card } from "@/lib/types";
import type { CardStageCardModel } from "@/lib/card-stage-card";
import type { CardStageProps } from "./card-stage/types";
import { render, textContent } from "@/test/dom";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
  plainTextToPortableRichText,
} from "../../../shared/block-documents";
import { populateBlockDocumentBodyFromNfm } from "../../../shared/block-documents/block-document-codec";

let lastNfmEditorProps: Record<string, unknown> | null = null;
let surfaceDocument = createCardDocument({
  documentId: "document:card-1",
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

vi.mock("@/components/block-documents/collaborative-card-title", () => ({
  CollaborativeCardTitle: ({
    onValueChange,
  }: {
    onValueChange?: (title: string) => void;
  }) => {
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

vi.mock("./card-stage/inline-property-strip", () => ({
  CardStageInlinePropertyStrip: () => <div>Inline property strip</div>,
}));

vi.mock("./card-stage/properties-section", () => ({
  CardStagePropertiesSection: () => <div>Properties section</div>,
}));

function buildCard(overrides: Partial<Card> = {}): Card {
  const title = overrides.title ?? "Stale projected title";
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    description: "Stale projected body",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function toStageModel(card: Card): CardStageCardModel {
  return {
    card: {
      id: card.id,
      archived: card.archived,
      title: card.title,
      richTitle: card.richTitle,
      isAllDay: Boolean(card.isAllDay),
      reminders: card.reminders ?? [],
      agentBlocked: card.agentBlocked,
      revision: card.revision ?? 1,
      created: card.created,
    },
    databaseContext: {
      kind: "member",
      membership: {
        id: "membership-1",
        databaseBlockId: "database-1",
        revision: 1,
      },
      compatibilityProperties: {
        status: card.status,
        tags: card.tags,
      },
    },
  };
}

function documentAuthority() {
  return {
    kind: "yjs" as const,
    descriptor: {
      projectId: "default",
      ownerBlockId: "card-1",
      ownerType: "card" as const,
      ownerLifecycle: "active" as const,
      documentId: "document:card-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.card" as const,
      schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION as 2,
      readiness: "ready" as const,
      sync: { kind: "yjs" as const, stateVector: new Uint8Array() },
    },
    reload: async () => undefined,
  };
}

function renderStage(
  card: CardStageCardModel = toStageModel(buildCard()),
  titleCallbacks: Pick<CardStageProps, "onTitleChange" | "onTitleSourceDispose"> = {},
) {
  const { CardStage } = requireCardStage();
  return render(
    <NodexTooltipProvider>
      <CardStage
        onClose={() => undefined}
        card={card}
        projectId="default"
        projectName="Default"
        documentAuthority={documentAuthority()}
        availableTags={[]}
        onUpdate={async () => ({ status: "updated", didMutate: true })}
        {...titleCallbacks}
        {...(card.databaseContext.kind === "member"
          ? {
              onDelete: async () => undefined,
              onMove: async () => undefined,
            }
          : {})}
      />
    </NodexTooltipProvider>,
  );
}

let loadedCardStage: typeof import("./card-stage") | null = null;
function requireCardStage(): typeof import("./card-stage") {
  if (!loadedCardStage) throw new Error("Card Stage module has not loaded");
  return loadedCardStage;
}

describe("card stage", () => {
  beforeEach(async () => {
    localStorage.clear();
    lastNfmEditorProps = null;
    surfaceDocument.document.destroy();
    surfaceDocument = createCardDocument({
      documentId: "document:card-1",
      initialTitle: "Live title",
    });
    populateBlockDocumentBodyFromNfm(
      surfaceDocument.body,
      "# Live collaborative body\n\n- item",
    );
    loadedCardStage = await import("./card-stage");
  });

  test("mounts the rich editor only from the collaborative Document source", () => {
    writeCardStageContentWidthPreference(true);
    writeCardStageShowRawContentPreference(false);
    const { container, getByText } = renderStage();

    expect(getByText("Mock collaborative editor").textContent).toBe(
      "Mock collaborative editor",
    );
    const source = lastNfmEditorProps?.source as Record<string, unknown>;
    expect(source.kind).toBe("collaborative-document");
    expect(source.documentId).toBe("document:card-1");
    expect(Object.hasOwn(source, "content")).toBe(false);
    expect(Object.hasOwn(source, "onChange")).toBe(false);
    expect(container.querySelector('[data-card-stage-heading-navigation-portal-target="true"]')).not.toBeNull();
  });

  test("publishes the initial Y.Text title and disposes its live source", async () => {
    const onTitleChange = vi.fn();
    const onTitleSourceDispose = vi.fn();
    const view = renderStage(toStageModel(buildCard()), {
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

  test("opens a standalone Card without Database controls or delete", () => {
    const member = toStageModel(buildCard());
    const standalone: CardStageCardModel = {
      card: member.card,
      databaseContext: { kind: "standalone" },
    };
    const { queryByText, queryByRole, getByText } = renderStage(standalone);

    expect(getByText("Mock collaborative editor")).toBeTruthy();
    expect(queryByText("Inline property strip")).toBeNull();
    expect(queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("raw mode reads the live Y.Doc projection, not Card.description", () => {
    writeCardStageShowRawContentPreference(true);
    const { container, getByText, queryByText } = renderStage();

    expect(getByText("Raw format").textContent).toBe("Raw format");
    expect(queryByText("Mock collaborative editor")).toBe(null);
    expect(textContent(container).includes("Live collaborative body")).toBe(true);
    expect(textContent(container).includes("Stale projected body")).toBe(false);
  });

  test("full width changes only the Card Stage presentation lane", async () => {
    writeCardStageContentWidthPreference(true);
    writeCardStageShowRawContentPreference(false);
    const { container, getByRole } = renderStage();
    const body = container.querySelector('[data-card-stage-body="true"]');
    const fullWidthButton = getByRole("button", { name: "Full width" });

    expect(body?.getAttribute("data-card-stage-body-width")).toBe("constrained");
    await act(async () => {
      (fullWidthButton as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(body?.getAttribute("data-card-stage-body-width")).toBe("full");
  });
});
