import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { CardReferenceReadModel } from "../../../shared/block-references";
import type { DatabaseViewReadModel } from "../../../shared/database-views";
import type { CardSummary } from "@/lib/types";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";
import { render } from "@/test/dom";
import {
  CardReferenceSurface,
  DatabaseViewReferenceSurface,
} from "./reference-block-surfaces";

const makeCard = (id: string, title: string): CardSummary => ({
  id,
  status: "in_progress",
  archived: false,
  title,
  priority: "p1-high",
  estimate: "m",
  tags: [],
  agentBlocked: false,
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

const availableReference = (
  card: CardSummary,
  projectId = "target-project",
): Extract<CardReferenceReadModel, { readonly status: "available" }> => ({
  status: "available",
  targetBlockId: card.id,
  projectId,
  lifecycle: "active",
  summary: card,
  document: {
    documentId: `document:${card.id}`,
    generation: 1,
    headSeq: 2,
    readiness: "ready",
    authority: "ydoc_primary",
    schemaKey: "nodex.card",
    schemaVersion: 1,
  },
});

describe("CardReferenceSurface", () => {
  test("mounts the target Card document only after local expansion", async () => {
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const card = makeCard("card-target", "Target Card");
    const view = render(
      <CardReferenceSurface
        referenceKey="host:block:card-target"
        displayHint=""
        model={availableReference(card)}
        expansionStore={expansionStore}
        activationBudget={activationBudget}
        visibilityOverride
        renderDocument={({ projectId, card: target }) => (
          <div data-testid="referenced-document">
            {projectId}:{target.id}
          </div>
        )}
      />,
    );

    expect(view.queryByTestId("referenced-document") === null).toBe(true);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Expand Target Card" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("referenced-document").textContent).toBe(
        "target-project:card-target",
      );
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Collapse Target Card" }),
      );
      await Promise.resolve();
    });
    expect(view.queryByTestId("referenced-document") === null).toBe(true);
  });

  test("never offers an inline editor for archived Card targets", () => {
    const card = makeCard("archived", "Archived Card");
    const model: CardReferenceReadModel = {
      ...availableReference(card),
      lifecycle: "archived",
    };
    const view = render(
      <CardReferenceSurface
        referenceKey="archived"
        displayHint=""
        model={model}
        renderDocument={() => <div>Must not mount</div>}
      />,
    );
    expect(
      (
        view.getByRole("button", {
          name: "Expand Archived Card",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test("lets the owned boundary prepare active non-primary Cards", async () => {
    const card = makeCard("pending", "Pending Card");
    const model: CardReferenceReadModel = {
      ...availableReference(card),
      document: {
        ...availableReference(card).document,
        readiness: "pending_genesis",
        authority: "legacy_shadow",
      },
    };
    const view = render(
      <CardReferenceSurface
        referenceKey="pending"
        displayHint=""
        model={model}
        visibilityOverride
        renderDocument={() => (
          <div data-testid="prepare-boundary">Preparing</div>
        )}
      />,
    );

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Expand Pending Card" }),
      );
      await Promise.resolve();
    });
    expect(view.getByTestId("prepare-boundary").textContent).toBe("Preparing");
  });

  test("blocks indirect inline Document cycles but keeps Stage navigation", () => {
    const openCalls: string[] = [];
    const card = makeCard("card-a", "Card A");
    const view = render(
      <CardReferenceSurface
        referenceKey="card-b-to-a"
        displayHint=""
        model={availableReference(card)}
        hostCardId="card-b"
        ancestorCardIds={["card-a", "card-b"]}
        visibilityOverride
        renderDocument={() => <div>Must not mount</div>}
        onOpenCard={({ cardId }) => {
          openCalls.push(cardId);
        }}
      />,
    );

    expect(
      (view.getByRole("button", { name: "Expand Card A" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(view.getByText("Cycle").textContent).toBe("Cycle");
    fireEvent.click(view.getByRole("button", { name: "Open Card A" }));
    expect(openCalls.join(",")).toBe("card-a");
  });

  test("counts duplicate semantic references as independent provider instances", async () => {
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const card = makeCard("shared", "Shared Card");
    const renderReferences = (showFirst: boolean) => (
      <>
        {showFirst ? (
          <CardReferenceSurface
            referenceKey="same-reference"
            displayHint=""
            model={availableReference(card)}
            expansionStore={expansionStore}
            activationBudget={activationBudget}
            visibilityOverride
            renderDocument={() => (
              <div data-testid="duplicate-document">First</div>
            )}
          />
        ) : null}
        <CardReferenceSurface
          referenceKey="same-reference"
          displayHint=""
          model={availableReference(card)}
          expansionStore={expansionStore}
          activationBudget={activationBudget}
          visibilityOverride
          renderDocument={() => (
            <div data-testid="duplicate-document">Second</div>
          )}
        />
      </>
    );
    const view = render(renderReferences(true));

    await act(async () => {
      for (const button of view.getAllByRole("button", {
        name: "Expand Shared Card",
      })) {
        fireEvent.click(button);
        await Promise.resolve();
      }
    });
    await waitFor(() => {
      expect(view.getAllByTestId("duplicate-document").length).toBe(2);
    });

    view.rerender(renderReferences(false));
    await waitFor(() => {
      expect(view.getByTestId("duplicate-document").textContent).toBe("Second");
      expect(activationBudget.getActiveKeys().length).toBe(1);
    });
  });
});

describe("DatabaseViewReferenceSurface", () => {
  test("does not mount a Database row that closes an ancestor Card cycle", () => {
    const card = makeCard("card-a", "Card A");
    const model: DatabaseViewReadModel = {
      view: {
        id: "cycle-view",
        databaseBlockId: "database-1",
        projectId: "database-project",
        name: "Cycle view",
        kind: "list",
        config: {},
        isPrimary: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      rows: [{ card, groupKey: "draft", rankKey: "a" }],
    };
    const view = render(
      <DatabaseViewReferenceSurface
        referenceKey="card-b-view"
        displayHint=""
        model={model}
        hostCardId="card-b"
        ancestorCardIds={["card-a", "card-b"]}
        visibilityOverride
        renderDocument={() => <div>Must not mount</div>}
      />,
    );

    expect(
      (view.getByRole("button", { name: "Expand Card A" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(view.getByText("Cycle").textContent).toBe("Cycle");
  });

  test("bounds simultaneous referenced Card providers across a large expanded view", async () => {
    const cards = [
      makeCard("card-1", "Card One"),
      makeCard("card-2", "Card Two"),
      makeCard("card-3", "Card Three"),
      makeCard("card-4", "Card Four"),
    ];
    const model: DatabaseViewReadModel = {
      view: {
        id: "view-1",
        databaseBlockId: "database-1",
        projectId: "database-project",
        name: "Focused work",
        kind: "list",
        config: {},
        isPrimary: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      rows: cards.map((card, index) => ({
        card,
        groupKey: null,
        rankKey: String(index),
      })),
    };
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const view = render(
      <DatabaseViewReferenceSurface
        referenceKey="host:view-1"
        displayHint=""
        model={model}
        expansionStore={expansionStore}
        activationBudget={activationBudget}
        visibilityOverride
        renderDocument={({ projectId, card }) => (
          <div data-testid="database-row-document">
            {projectId}:{card.id}
          </div>
        )}
      />,
    );

    await act(async () => {
      for (const card of cards) {
        fireEvent.click(
          view.getByRole("button", { name: `Expand ${card.title}` }),
        );
        await Promise.resolve();
      }
    });
    await waitFor(() => {
      expect(view.getAllByTestId("database-row-document").length).toBe(2);
    });
    const activeText = view
      .getAllByTestId("database-row-document")
      .map((element) => element.textContent)
      .join(",");
    expect(activeText.includes("database-project:card-3")).toBe(true);
    expect(activeText.includes("database-project:card-4")).toBe(true);
    expect(activeText.includes("card-1")).toBe(false);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Collapse Card Four" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      const resumedText = view
        .getAllByTestId("database-row-document")
        .map((element) => element.textContent)
        .join(",");
      expect(resumedText.includes("database-project:card-2")).toBe(true);
      expect(resumedText.includes("database-project:card-3")).toBe(true);
    });
  });

  test("keeps the focused inline editor resident when a newer row activates", async () => {
    const cards = [
      makeCard("focus-1", "Focus One"),
      makeCard("focus-2", "Focus Two"),
      makeCard("focus-3", "Focus Three"),
    ];
    const model: DatabaseViewReadModel = {
      view: {
        id: "focus-view",
        databaseBlockId: "database-1",
        projectId: "database-project",
        name: "Focus order",
        kind: "list",
        config: {},
        isPrimary: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      rows: cards.map((card, index) => ({
        card,
        groupKey: null,
        rankKey: String(index),
      })),
    };
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const view = render(
      <DatabaseViewReferenceSurface
        referenceKey="focus-view"
        displayHint=""
        model={model}
        expansionStore={expansionStore}
        activationBudget={activationBudget}
        visibilityOverride
        renderDocument={({ card }) => (
          <input data-testid={`focus-${card.id}`} defaultValue={card.title} />
        )}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Expand Focus One" }));
      fireEvent.click(view.getByRole("button", { name: "Expand Focus Two" }));
      await Promise.resolve();
    });
    fireEvent.focus(view.getByTestId("focus-focus-1"));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Expand Focus Three" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.queryByTestId("focus-focus-1") === null).toBe(false);
      expect(view.queryByTestId("focus-focus-2") === null).toBe(true);
      expect(view.queryByTestId("focus-focus-3") === null).toBe(false);
    });
  });
});
