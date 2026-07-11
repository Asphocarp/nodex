import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type { GeneralDatabaseCatalog } from "../../../shared/database-query";
import { render } from "../../test/dom";

const catalog: GeneralDatabaseCatalog = {
  databases: [
    {
      database: {
        blockId: "database-primary",
        projectId: "project-1",
        name: "Tasks",
        isPrimary: true,
        schemaKey: "nodex.database",
        schemaRevision: 2,
        metadataRevision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      properties: [
        {
          id: "property-tags",
          databaseBlockId: "database-primary",
          key: "tags",
          name: "Tags",
          valueType: "multi_select",
          config: {
            options: [{ id: "option-block-first", name: "Block first" }],
          },
          rankKey: "1",
          lifecycle: "active",
          revision: 1,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      views: [
        {
          id: "view-primary",
          databaseBlockId: "database-primary",
          projectId: "project-1",
          name: "Board",
          kind: "kanban",
          config: {
            schemaKey: "nodex.database-view",
            schemaVersion: 1,
            filter: { kind: "group", operator: "and", children: [] },
            sort: [],
            group: null,
            display: { propertyIds: [], showTitle: true },
          },
          isPrimary: true,
          revision: 1,
          rankKey: "1",
          lifecycle: "active",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
    },
    {
      database: {
        blockId: "database-research",
        projectId: "project-1",
        name: "Research",
        isPrimary: false,
        schemaKey: "nodex.database",
        schemaRevision: 1,
        metadataRevision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      properties: [],
      views: [],
    },
  ],
};

const noop = () => undefined;

describe("DatabaseManagementDialog", () => {
  test("emits stable management intents instead of mutating descriptor state", async () => {
    const createdDatabases: unknown[] = [];
    const createdProperties: unknown[] = [];
    const createdViews: unknown[] = [];
    const deletedOptions: unknown[] = [];
    const selected: string[] = [];
    const { DatabaseManagementSurface } = await import("./database-management-dialog");
    const screen = render(
      <DatabaseManagementSurface
        catalog={catalog}
        selectedDatabaseBlockId="database-primary"
        onSelectDatabase={(databaseBlockId) => selected.push(databaseBlockId)}
        onCreateDatabase={(draft) => {
          createdDatabases.push(draft);
        }}
        onCreateProperty={(draft) => {
          createdProperties.push(draft);
        }}
        onDeleteProperty={noop}
        onCreateView={(draft) => {
          createdViews.push(draft);
        }}
        onDeleteView={noop}
        onPutPropertyOption={noop}
        onDeletePropertyOption={(...args) => {
          deletedOptions.push(args);
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Research" }));
      await Promise.resolve();
    });
    expect(selected[0]).toBe("database-research");

    await act(async () => {
      fireEvent.input(screen.getByLabelText("New Database name"), {
        target: { value: "Knowledge" },
      });
      await Promise.resolve();
    });
    expect((screen.getByLabelText("New Database name") as HTMLInputElement).value).toBe("Knowledge");
    expect((screen.getByRole("button", { name: "Create Database" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("New Database name").closest("form")!);
      await Promise.resolve();
    });
    expect(JSON.stringify(createdDatabases[0])).toBe(JSON.stringify({ name: "Knowledge" }));

    await act(async () => {
      fireEvent.input(screen.getByLabelText("New property name"), {
        target: { value: "Score" },
      });
      fireEvent.change(screen.getByLabelText("New property type"), {
        target: { value: "number" },
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("New property name").closest("form")!);
      await Promise.resolve();
    });
    expect(JSON.stringify(createdProperties[0])).toBe(JSON.stringify({
      databaseBlockId: "database-primary",
      name: "Score",
      valueType: "number",
    }));

    await act(async () => {
      fireEvent.input(screen.getByLabelText("New View name"), {
        target: { value: "Timeline" },
      });
      fireEvent.change(screen.getByLabelText("New View kind"), {
        target: { value: "calendar" },
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("New View name").closest("form")!);
      await Promise.resolve();
    });
    expect(JSON.stringify(createdViews[0])).toBe(JSON.stringify({
      databaseBlockId: "database-primary",
      name: "Timeline",
      kind: "calendar",
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete option Block first" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(deletedOptions[0])).toBe(JSON.stringify([
      "database-primary",
      "property-tags",
      "option-block-first",
    ]));
  });
});
