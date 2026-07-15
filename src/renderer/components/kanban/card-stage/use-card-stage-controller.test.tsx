import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import type {
  Card,
  CardInput,
} from "@/lib/types";
import type { CardStageCardModel } from "@/lib/card-stage-card";
import { render, settleAsyncRender } from "@/test/dom";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../../../shared/block-documents";
import {
  useCardStageController,
  type CardStageControllerDependencies,
} from "./use-card-stage-controller";
import type { CardStageProps } from "./types";

type CardStageController = ReturnType<typeof useCardStageController>;

function buildCard(overrides: Partial<Card> = {}): Card {
  const title = overrides.title ?? "Projected title";
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    description: "Projected body",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function updatedResult(
  card: Card,
  updates: Partial<CardInput>,
) {
  void card;
  void updates;
  return { status: "updated", didMutate: true } as const;
}

function toStageModel(card: Card): CardStageCardModel {
  return {
    card: {
      id: card.id,
      archived: card.archived,
      title: card.title,
      richTitle: card.richTitle,
      isAllDay: Boolean(card.isAllDay),
      recurrence: card.recurrence,
      reminders: card.reminders ?? [],
      scheduleTimezone: card.scheduleTimezone,
      agentBlocked: card.agentBlocked,
      agentStatus: card.agentStatus,
      runInTarget: card.runInTarget,
      runInLocalPath: card.runInLocalPath,
      runInBaseBranch: card.runInBaseBranch,
      runInWorktreePath: card.runInWorktreePath,
      runInEnvironmentPath: card.runInEnvironmentPath,
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
        priority: card.priority,
        estimate: card.estimate,
        tags: card.tags,
        dueDate: card.dueDate,
        scheduledStart: card.scheduledStart,
        scheduledEnd: card.scheduledEnd,
        assignee: card.assignee,
      },
    },
  };
}

function documentAuthority(): CardStageProps["documentAuthority"] {
  return {
    kind: "yjs",
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
      schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
      readiness: "ready",
      sync: { kind: "yjs", stateVector: new Uint8Array() },
    },
    reload: async () => undefined,
  };
}

function buildProps(overrides: Partial<CardStageProps> = {}): CardStageProps {
  const sourceCard = buildCard();
  const card = overrides.card === undefined ? toStageModel(sourceCard) : overrides.card;
  return {
    card,
    documentAuthority: documentAuthority(),
    projectId: "project-1",
    availableTags: [],
    onClose: () => undefined,
    onUpdate: async (_cardId, updates) =>
      updatedResult(sourceCard, updates),
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
  let renderCount = 0;

  function Harness({ nextProps, children }: {
    nextProps: CardStageProps;
    children?: ReactNode;
  }) {
    renderCount += 1;
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
    get renderCount(): number {
      return renderCount;
    },
    rerender(nextProps: CardStageProps): void {
      view.rerender(<Harness nextProps={nextProps} />);
    },
  };
}

describe("useCardStageController", () => {
  test("does not resynchronize an unchanged metadata revision when command props are recreated", async () => {
    const initialCard = buildCard();
    const result = renderController(buildProps({
      card: toStageModel(initialCard),
      onUpdate: async (_cardId, patch) => updatedResult(initialCard, patch),
    }));
    await settleAsyncRender();
    const settledRenderCount = result.renderCount;

    const equivalentCard = buildCard();
    await act(async () => {
      result.rerender(buildProps({
        card: toStageModel(equivalentCard),
        onUpdate: async (_cardId, patch) => updatedResult(equivalentCard, patch),
      }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(result.renderCount - settledRenderCount).toBe(1);
  });

  test("keeps collaborative title changes out of metadata writes", async () => {
    const updates: Partial<CardInput>[] = [];
    const leftTitles: string[] = [];
    let persisted = 0;
    const result = renderController(
      buildProps({
        onLeaveCard: (snapshot) => leftTitles.push(snapshot.titleSnapshot),
        onUpdate: async (_cardId, patch) => {
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
      onUpdate: async (_cardId, patch) => {
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
      onUpdate: async (_cardId, patch) => {
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
        onUpdate: async (_cardId, patch) => {
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
