import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { render } from "../../test/dom";
import { ReadOnlyDatabaseView } from "./read-only-database-view";

const model: DatabaseViewRenderModel = {
  projectId: "project-1",
  databaseViewId: "view-focused",
  databaseBlockId: "database-1",
  databaseName: "Tasks",
  viewName: "Focused",
  storeEpoch: "epoch-1",
  changeLogSeq: 2,
  primaryWriteCompatible: false,
  readOnlyReason: "Writes require the selected View identity.",
  query: { view: { kind: "list" } } as DatabaseViewRenderModel["query"],
  columns: [{
      id: "in_progress",
      name: "In Progress",
      rows: [{
        blockId: "card-focused",
        status: "in_progress",
        title: "Focused Card",
        preview: "",
        plainText: "",
        tags: ["selected-view"],
        metadataRevision: 1,
        createdAt: new Date("2026-07-12T00:00:00.000Z"),
      }],
  }],
};

describe("ReadOnlyDatabaseView", () => {
  test("renders the selected View rows and opens their stable Card identity", () => {
    const opened: unknown[][] = [];
    const screen = render(
      <ReadOnlyDatabaseView
        model={model}
        searchQuery="focused"
        openCardStage={(...args) => opened.push(args)}
      />,
    );

    expect(screen.getByRole("status").textContent?.includes("View only") ?? false).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Focused Card/ }));
    expect(JSON.stringify(opened[0])).toBe(JSON.stringify([
      "project-1",
      "card-focused",
      "Focused Card",
      { openMode: "preview" },
    ]));
  });
});
