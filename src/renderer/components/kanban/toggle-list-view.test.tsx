import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DbViewCardRecord } from "@/lib/db-view-prefs";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";
import { render } from "@/test/dom";
import { ToggleListReferenceRows } from "./toggle-list-view";

const makeCard = (
  overrides: Partial<DbViewCardRecord> = {},
): DbViewCardRecord => ({
  id: "card-1",
  status: "in_progress",
  archived: false,
  title: "Collaborative Card",
  priority: "p1-high",
  estimate: "m",
  tags: ["sync"],
  agentBlocked: false,
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "Summary preview is not an editable body.",
  descriptionLength: 40,
  hasDescription: true,
  columnId: "in_progress",
  columnName: "In Progress",
  boardIndex: 0,
  ...overrides,
});

describe("ToggleListReferenceRows", () => {
  test("mounts a Card's independent document only while its visible row is expanded", async () => {
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        cards={[makeCard()]}
        propertyOrder={["priority", "estimate", "status", "tags"]}
        hiddenProperties={[]}
        showEmptyEstimate={false}
        showEmptyPriority={false}
        expansionStore={expansionStore}
        activationBudget={activationBudget}
        visibilityOverride
        renderDocument={({ projectId, card }) => (
          <div data-testid="owned-card-document">
            {projectId}:{card.id}
          </div>
        )}
      />,
    );

    expect(view.queryByTestId("owned-card-document") === null).toBe(true);
    expect(
      view.container.querySelector('[draggable="true"]') === null,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Expand Collaborative Card" }),
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("owned-card-document").textContent).toBe(
        "project-1:card-1",
      );
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Collapse Collaborative Card" }),
      );
      await Promise.resolve();
    });
    expect(view.queryByTestId("owned-card-document") === null).toBe(true);
  });

  test("renders ordered summary metadata without loading or editing a body snapshot", () => {
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        cards={[makeCard()]}
        propertyOrder={["status", "tags", "priority", "estimate"]}
        hiddenProperties={["estimate"]}
        showEmptyEstimate={false}
        showEmptyPriority={false}
        visibilityOverride
        renderDocument={() => null}
      />,
    );

    const status = view.getByText("In Progress");
    const tag = view.getByText("sync");
    const priority = view.getByText("P1");
    expect(
      Boolean(
        status.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        tag.compareDocumentPosition(priority) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(view.queryByText("M") === null).toBe(true);
    expect(
      view.container.textContent?.includes(
        "Summary preview is not an editable body",
      ) ?? false,
    ).toBe(false);
  });

  test("preserves explicit empty priority and estimate display preferences", () => {
    const card = makeCard();
    delete card.priority;
    delete card.estimate;
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        cards={[card]}
        propertyOrder={["priority", "estimate"]}
        hiddenProperties={[]}
        showEmptyEstimate
        showEmptyPriority
        visibilityOverride
        renderDocument={() => null}
      />,
    );

    expect(view.getByTitle("No priority").textContent).toBe("—");
    expect(view.getByTitle("No estimate").textContent).toBe("—");
  });

  test("opens the Card Stage from the summary row without activating its editor", () => {
    const opened: string[] = [];
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        cards={[makeCard()]}
        propertyOrder={[]}
        hiddenProperties={[]}
        showEmptyEstimate={false}
        showEmptyPriority={false}
        visibilityOverride
        renderDocument={() => <div data-testid="must-stay-closed" />}
        onOpenCard={({ projectId, cardId }) => {
          opened.push(`${projectId}:${cardId}`);
        }}
      />,
    );

    fireEvent.click(
      view.getByRole("button", { name: "Open Collaborative Card" }),
    );
    expect(opened.join(",")).toBe("project-1:card-1");
    expect(view.queryByTestId("must-stay-closed") === null).toBe(true);
  });
});
