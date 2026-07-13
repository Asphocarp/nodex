import { act } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  writeCardStageContentWidthPreference,
  writeCardStageShowRawContentPreference,
} from "@/lib/card-stage-layout";
import type { Card, CardUpdateMutationResult } from "@/lib/types";
import { render, textContent } from "@/test/dom";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
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
  CollaborativeCardTitle: () => <div>Live title</div>,
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
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title: "Stale projected title",
    description: "Stale projected body",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function buildUpdateAck(card: Card = buildCard({ revision: 2 })): CardUpdateMutationResult {
  const { description, ...summary } = card;
  return {
    status: "updated",
    projectId: "default",
    cardId: card.id,
    revision: card.revision ?? 2,
    summary: {
      ...summary,
      descriptionPreview: description,
      descriptionLength: description.length,
      hasDescription: description.trim().length > 0,
    },
    changedFields: [],
    didMutate: true,
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

function renderStage() {
  const { CardStage } = requireCardStage();
  return render(
    <NodexTooltipProvider>
      <CardStage
        onClose={() => undefined}
        card={buildCard()}
        columnId="in_progress"
        columnName="In progress"
        projectId="default"
        projectName="Default"
        documentAuthority={documentAuthority()}
        availableTags={[]}
        onUpdate={async () => buildUpdateAck()}
        onDelete={async () => undefined}
        onMove={async () => undefined}
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
