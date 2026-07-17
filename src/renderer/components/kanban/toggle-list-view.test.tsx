import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DbViewCardRecord } from "@/lib/db-view-prefs";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import {
  BlockDisclosureStateStore,
} from "@/lib/block-disclosure-state";
import {
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";
import { render } from "@/test/dom";
import { ToggleListReferenceRows } from "./toggle-list-view";

const makeCard = (
  overrides: Partial<DbViewCardRecord> = {},
): DbViewCardRecord => {
  const title = overrides.title ?? "Collaborative Card";
  return {
    id: "card-1",
    status: "build",
    archived: false,
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    priority: "p1-high",
    estimate: "m",
    tags: ["sync"],
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 0,
    descriptionPreview: "Summary preview is not an editable body.",
    descriptionLength: 40,
    hasDescription: true,
    columnId: "build",
    columnName: "Build",
    boardIndex: 0,
    ...overrides,
  };
};

describe("ToggleListReferenceRows", () => {
  test("mounts a Card's independent document only while its visible row is expanded", async () => {
    const disclosureStore = new BlockDisclosureStateStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        disclosureScopeKey="toggle-list:view-1"
        cards={[makeCard()]}
        propertyOrder={["priority", "estimate", "status", "tags"]}
        hiddenProperties={[]}
        showEmptyEstimate={false}
        showEmptyPriority={false}
        disclosureStore={disclosureStore}
        activationBudget={activationBudget}
        visibilityOverride
        renderDocument={({ projectId, card }) => (
          <div data-testid="owned-page-document">
            {projectId}:{card.id}
          </div>
        )}
      />,
    );

    expect(view.queryByTestId("owned-page-document") === null).toBe(true);
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
      expect(view.getByTestId("owned-page-document").textContent).toBe(
        "project-1:card-1",
      );
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Collapse Collaborative Card" }),
      );
      await Promise.resolve();
    });
    expect(view.queryByTestId("owned-page-document") === null).toBe(true);
  });

  test("renders ordered summary metadata without loading or editing a body snapshot", () => {
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        disclosureScopeKey="toggle-list:view-1"
        cards={[makeCard()]}
        propertyOrder={["status", "tags", "priority", "estimate"]}
        hiddenProperties={["estimate"]}
        showEmptyEstimate={false}
        showEmptyPriority={false}
        visibilityOverride
        renderDocument={() => null}
      />,
    );

    const status = view.getByText("Build");
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
        disclosureScopeKey="toggle-list:view-1"
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

  test("opens the Page Stage from the summary row without activating its editor", () => {
    const opened: string[] = [];
    const view = render(
      <ToggleListReferenceRows
        projectId="project-1"
        disclosureScopeKey="toggle-list:view-1"
        cards={[makeCard()]}
        propertyOrder={[]}
        hiddenProperties={[]}
        showEmptyEstimate={false}
        showEmptyPriority={false}
        visibilityOverride
        renderDocument={() => <div data-testid="must-stay-closed" />}
        onOpenPage={({ projectId, pageId }) => {
          opened.push(`${projectId}:${pageId}`);
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
