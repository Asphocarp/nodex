import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import type {
  Card,
  CardInput,
  CardSummary,
  CardUpdateField,
  CardUpdateMutationResult,
} from "@/lib/types";
import { render, settleAsyncRender } from "@/test/dom";
import {
  useCardStageController,
  type CardStageControllerDependencies,
} from "./use-card-stage-controller";
import type { CardStageProps } from "./types";

type CardStageController = ReturnType<typeof useCardStageController>;

function buildCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title: "Projected title",
    description: "Projected body",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function toSummary(card: Card): CardSummary {
  const { description, ...summary } = card;
  return {
    ...summary,
    descriptionPreview: description,
    descriptionLength: description.length,
    hasDescription: description.trim().length > 0,
  };
}

function updatedResult(
  card: Card,
  updates: Partial<CardInput>,
): CardUpdateMutationResult {
  const nextCard = { ...card, revision: (card.revision ?? 0) + 1 };
  return {
    status: "updated",
    projectId: "project-1",
    cardId: card.id,
    revision: nextCard.revision,
    summary: toSummary(nextCard),
    changedFields: Object.keys(updates) as CardUpdateField[],
    didMutate: true,
  };
}

function documentAuthority(): CardStageProps["documentAuthority"] {
  return {
    kind: "ydoc_primary",
    descriptor: {
      projectId: "project-1",
      ownerBlockId: "card-1",
      ownerType: "card",
      ownerLifecycle: "active",
      documentId: "document-1",
      storeEpoch: "store-epoch-1",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.card",
      schemaVersion: 1,
      readiness: "ready",
      authority: "ydoc_primary",
      stateVector: new Uint8Array(),
    },
    reload: async () => undefined,
  };
}

function buildProps(overrides: Partial<CardStageProps> = {}): CardStageProps {
  const card = overrides.card === undefined ? buildCard() : overrides.card;
  return {
    card,
    documentAuthority: documentAuthority(),
    columnId: "in_progress",
    columnName: "In progress",
    projectId: "project-1",
    availableTags: [],
    onClose: () => undefined,
    onUpdate: async (_columnId, _cardId, updates) =>
      updatedResult(card ?? buildCard(), updates),
    onDelete: async () => undefined,
    onMove: async () => undefined,
    ...overrides,
  };
}

function renderController(
  props: CardStageProps,
  dependencies: CardStageControllerDependencies = {},
) {
  let controller: CardStageController | null = null;

  function Harness({ nextProps, children }: {
    nextProps: CardStageProps;
    children?: ReactNode;
  }) {
    controller = useCardStageController(nextProps, dependencies);
    return <>{children}</>;
  }

  const view = render(<Harness nextProps={props} />);
  if (!controller) throw new Error("Expected Card Stage controller to render");

  return {
    view,
    get controller(): CardStageController {
      if (!controller) throw new Error("Expected Card Stage controller");
      return controller;
    },
  };
}

describe("useCardStageController", () => {
  test("keeps collaborative title changes out of metadata writes", async () => {
    const updates: Partial<CardInput>[] = [];
    const leftTitles: string[] = [];
    let persisted = 0;
    const result = renderController(
      buildProps({
        onLeaveCard: (snapshot) => leftTitles.push(snapshot.titleSnapshot),
        onUpdate: async (_columnId, _cardId, patch) => {
          updates.push(patch);
          return updatedResult(buildCard(), patch);
        },
      }),
      {
        persistDocument: async () => {
          persisted += 1;
        },
      },
    );
    await settleAsyncRender();

    act(() => result.controller.handleDocumentTitleChange("Live Y.Text title"));
    await act(async () => result.controller.handleClose());

    expect(persisted).toBe(1);
    expect(updates.length).toBe(0);
    expect(leftTitles.join(",")).toBe("Live Y.Text title");
  });

  test("persists freeform metadata without title or description fields", async () => {
    const updates: Partial<CardInput>[] = [];
    const result = renderController(buildProps({
      onUpdate: async (_columnId, _cardId, patch) => {
        updates.push(patch);
        return updatedResult(buildCard(), patch);
      },
    }));
    await settleAsyncRender();

    act(() => result.controller.handleAssigneeChange("alex"));
    await settleAsyncRender();
    act(() => result.controller.handleAssigneeBlur());
    await settleAsyncRender();

    expect(updates.length).toBe(1);
    expect(updates[0]?.assignee).toBe("alex");
    expect(Object.hasOwn(updates[0] ?? {}, "title")).toBe(false);
    expect(Object.hasOwn(updates[0] ?? {}, "description")).toBe(false);
  });

  test("does not offer or perform a stale whole-card overwrite after a property conflict", async () => {
    const updates: Partial<CardInput>[] = [];
    const latest = buildCard({ priority: "p0-critical", revision: 4 });
    const result = renderController(buildProps({
      onUpdate: async (_columnId, _cardId, patch) => {
        updates.push(patch);
        return {
          status: "conflict",
          projectId: "project-1",
          cardId: latest.id,
          revision: 4,
          card: latest,
          conflictedFields: ["priority"],
        };
      },
    }));
    await settleAsyncRender();

    act(() => result.controller.handlePriorityChange("p1-high"));
    await settleAsyncRender();

    expect(updates.length).toBe(1);
    expect(updates[0]?.priority).toBe("p1-high");
    expect("handleOverwriteMine" in result.controller).toBe(false);
  });

  test("flushes metadata and the owned Document together on close", async () => {
    const updates: Partial<CardInput>[] = [];
    let persisted = 0;
    const result = renderController(
      buildProps({
        onUpdate: async (_columnId, _cardId, patch) => {
          updates.push(patch);
          return updatedResult(buildCard(), patch);
        },
      }),
      {
        persistDocument: async () => {
          persisted += 1;
        },
      },
    );
    await settleAsyncRender();

    act(() => result.controller.handleAgentStatusChange("waiting"));
    await settleAsyncRender();
    await act(async () => result.controller.handleClose());

    expect(persisted).toBe(1);
    expect(updates.length).toBe(1);
    expect(updates[0]?.agentStatus).toBe("waiting");
    expect(Object.hasOwn(updates[0] ?? {}, "title")).toBe(false);
    expect(Object.hasOwn(updates[0] ?? {}, "description")).toBe(false);
  });
});
