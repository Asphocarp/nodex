import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../shared/block-documents";
import type { CardTargetChangedEvent } from "../../shared/card-target-events";
import type { CardTargetReadModel } from "../../shared/card-targets";
import { render } from "../test/dom";
import { TestQueryProvider } from "../test/query";
import { useCardTargetReadModels } from "./block-reference-queries";

const mocks = vi.hoisted(() => ({
  resolveCardTarget: vi.fn(),
  projectListeners: new Map<
    string,
    (event: CardTargetChangedEvent) => void
  >(),
}));

vi.mock("./api", () => ({
  resolveCardTarget: mocks.resolveCardTarget,
  readDatabaseViewReference: vi.fn(),
}));

vi.mock("./renderer-transport", () => ({
  resolveRendererTransport: () => ({
    subscribeBoardChanges: () => () => undefined,
    subscribeCardTargetChanges: (
      projectId: string,
      listener: (event: CardTargetChangedEvent) => void,
    ) => {
      mocks.projectListeners.set(projectId, listener);
      return () => {
        if (mocks.projectListeners.get(projectId) === listener) {
          mocks.projectListeners.delete(projectId);
        }
      };
    },
  }),
}));

function availableTarget(
  cardId: string,
  title: string,
): Extract<CardTargetReadModel, { readonly status: "available" }> {
  return {
    status: "available",
    targetBlockId: cardId,
    card: {
      blockId: cardId,
      projectId: "canonical-project",
      lifecycle: "active",
      location: { kind: "document", documentId: "host-document" },
      locationRevision: 1,
      metadataRevision: 1,
      documentId: `document:${cardId}`,
      documentGeneration: 1,
      documentHeadSeq: 2,
      documentAuthority: "ydoc_primary",
      content: {
        projectedSeq: 2,
        title,
        richTitle: plainTextToPortableRichText(title),
        preview: "",
        plainText: "",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    document: {
      readiness: "ready",
      schemaKey: "nodex.card",
      schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
    },
  };
}

function BreadcrumbTargetHarness() {
  const targets = useCardTargetReadModels("host-project", [
    "grandparent-card",
    "parent-card",
  ]);
  return (
    <output>
      {targets.map((target) =>
        target.data?.status === "available"
          ? target.data.card.content?.title
          : "pending").join("|")}
    </output>
  );
}

describe("useCardTargetReadModels", () => {
  beforeEach(() => {
    mocks.projectListeners.clear();
    mocks.resolveCardTarget.mockReset();
  });

  test("keeps every ancestor fresh through identity-specific invalidation", async () => {
    const titles = new Map([
      ["grandparent-card", "Grandparent"],
      ["parent-card", "Parent before rename"],
    ]);
    mocks.resolveCardTarget.mockImplementation(
      async ({ targetBlockId }: { targetBlockId: string }) =>
        availableTarget(targetBlockId, titles.get(targetBlockId) ?? "Untitled"),
    );

    const view = render(
      <TestQueryProvider>
        <BreadcrumbTargetHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByText("Grandparent|Parent before rename")).toBeTruthy();
    });
    expect(mocks.resolveCardTarget).toHaveBeenCalledTimes(2);

    titles.set("parent-card", "Parent after rename");
    await act(async () => {
      mocks.projectListeners.get("canonical-project")?.({
        projectId: "canonical-project",
        targetBlockId: "parent-card",
        changeKind: "content",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByText("Grandparent|Parent after rename")).toBeTruthy();
    });
    expect(mocks.resolveCardTarget).toHaveBeenCalledTimes(3);
  });
});
