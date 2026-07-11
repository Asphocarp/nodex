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

const cardState = (
  blockId: string,
  title: string,
  databaseBlockId: string | null,
) => ({
  card: {
    blockId,
    projectId: "project-1",
    lifecycle: "active" as const,
    location: { kind: "space" as const, rankKey: "1" },
    locationRevision: 1,
    metadataRevision: 1,
    documentId: `document-${blockId}`,
    documentGeneration: 1,
    documentHeadSeq: 1,
    documentAuthority: "ydoc_primary" as const,
    content: {
      projectedSeq: 1,
      title,
      preview: "",
      plainText: "",
    },
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  },
  membership: databaseBlockId
    ? {
        id: `membership-${blockId}`,
        databaseBlockId,
        cardBlockId: blockId,
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
      }
    : null,
  positions: [],
});

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
        cards={[]}
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
        onUpdateView={noop}
        onDeleteView={noop}
        onSetMembership={noop}
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

  test("writes Card membership and the selected durable View identity", async () => {
    const memberships: unknown[] = [];
    const updatedViews: unknown[] = [];
    const { DatabaseManagementSurface } = await import("./database-management-dialog");
    const screen = render(
      <DatabaseManagementSurface
        catalog={catalog}
        cards={[
          cardState("card-member", "Current member", "database-primary"),
          cardState("card-other", "Research note", "database-research"),
          cardState("card-free", "Unassigned", null),
        ]}
        selectedDatabaseBlockId="database-primary"
        onSelectDatabase={noop}
        onCreateDatabase={noop}
        onCreateProperty={noop}
        onDeleteProperty={noop}
        onCreateView={noop}
        onUpdateView={(draft) => {
          updatedViews.push(draft);
        }}
        onDeleteView={noop}
        onSetMembership={(draft) => {
          memberships.push(draft);
        }}
        onPutPropertyOption={noop}
        onDeletePropertyOption={noop}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Card Current member" }));
      fireEvent.click(screen.getByRole("button", { name: "Move here Card Research note" }));
      fireEvent.click(screen.getByRole("button", { name: "Add Card Unassigned" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(memberships)).toBe(JSON.stringify([
      { cardBlockId: "card-member", databaseBlockId: null },
      { cardBlockId: "card-other", databaseBlockId: "database-primary", viewId: "view-primary" },
      { cardBlockId: "card-free", databaseBlockId: "database-primary", viewId: "view-primary" },
    ]));

    await act(async () => {
      fireEvent.input(screen.getByLabelText("View name Board"), {
        target: { value: "Delivery" },
      });
      fireEvent.change(screen.getByLabelText("View kind Board"), {
        target: { value: "list" },
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save View Board" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(updatedViews[0])).toBe(JSON.stringify({
      databaseBlockId: "database-primary",
      viewId: "view-primary",
      expectedRevision: 1,
      name: "Delivery",
      kind: "list",
      config: catalog.databases[0]?.views[0]?.config,
    }));
  });

  test("authors durable filter, grouping, and display config from one captured View revision", async () => {
    const updatedViews: unknown[] = [];
    const { DatabaseManagementSurface } = await import("./database-management-dialog");
    const screen = render(
      <DatabaseManagementSurface
        catalog={catalog}
        cards={[]}
        selectedDatabaseBlockId="database-primary"
        onSelectDatabase={noop}
        onCreateDatabase={noop}
        onCreateProperty={noop}
        onDeleteProperty={noop}
        onCreateView={noop}
        onUpdateView={(draft) => {
          updatedViews.push(draft);
        }}
        onDeleteView={noop}
        onSetMembership={noop}
        onPutPropertyOption={noop}
        onDeletePropertyOption={noop}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit View settings Board" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Group View by property"), {
        target: { value: "property-tags" },
      });
      fireEvent.click(screen.getByLabelText("Title"));
      fireEvent.click(screen.getByRole("button", { name: "Rule" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save View Board" }));
      await Promise.resolve();
    });

    const draft = updatedViews[0] as {
      readonly expectedRevision: number;
      readonly config: {
        readonly filter: unknown;
        readonly group: unknown;
        readonly display: unknown;
      };
    };
    expect(draft.expectedRevision).toBe(1);
    expect(JSON.stringify(draft.config.filter)).toBe(JSON.stringify({
      kind: "group",
      operator: "and",
      children: [{
        kind: "clause",
        propertyId: "property-tags",
        operator: "equals",
        value: ["option-block-first"],
      }],
    }));
    expect(JSON.stringify(draft.config.group)).toBe(JSON.stringify({ propertyId: "property-tags" }));
    expect(JSON.stringify(draft.config.display)).toBe(JSON.stringify({ propertyIds: [], showTitle: false }));
  });

  test("adds membership through the selected durable View and logical Card anchor", async () => {
    const memberships: unknown[] = [];
    const anchored = {
      ...cardState("card-anchor", "Anchor", "database-primary"),
      positions: [{
        viewId: "view-primary",
        groupKey: null,
        rankKey: "a",
        revision: 1,
      }],
    };
    const { DatabaseManagementSurface } = await import("./database-management-dialog");
    const screen = render(
      <DatabaseManagementSurface
        catalog={catalog}
        cards={[anchored, cardState("card-free", "Unassigned", null)]}
        selectedDatabaseBlockId="database-primary"
        onSelectDatabase={noop}
        onCreateDatabase={noop}
        onCreateProperty={noop}
        onDeleteProperty={noop}
        onCreateView={noop}
        onUpdateView={noop}
        onDeleteView={noop}
        onSetMembership={(draft) => {
          memberships.push(draft);
        }}
        onPutPropertyOption={noop}
        onDeletePropertyOption={noop}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Membership position anchor"), {
        target: { value: "card-anchor" },
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Card Unassigned" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(memberships[0])).toBe(JSON.stringify({
      cardBlockId: "card-free",
      databaseBlockId: "database-primary",
      viewId: "view-primary",
      beforeCardBlockId: "card-anchor",
    }));
  });

  test("keeps a stale local View draft visible but blocks overwrite after a remote revision", async () => {
    const props = {
      cards: [],
      selectedDatabaseBlockId: "database-primary",
      onSelectDatabase: noop,
      onCreateDatabase: noop,
      onCreateProperty: noop,
      onDeleteProperty: noop,
      onCreateView: noop,
      onUpdateView: noop,
      onDeleteView: noop,
      onSetMembership: noop,
      onPutPropertyOption: noop,
      onDeletePropertyOption: noop,
    } as const;
    const { DatabaseManagementSurface } = await import("./database-management-dialog");
    const screen = render(<DatabaseManagementSurface catalog={catalog} {...props} />);

    await act(async () => {
      fireEvent.input(screen.getByLabelText("View name Board"), {
        target: { value: "Local draft" },
      });
      await Promise.resolve();
    });
    const primary = catalog.databases[0];
    const primaryView = primary?.views[0];
    if (!primary || !primaryView) throw new Error("Missing primary View fixture");
    const remoteCatalog: GeneralDatabaseCatalog = {
      databases: [{
        ...primary,
        views: [{ ...primaryView, name: "Remote rename", revision: 2 }],
      }, ...catalog.databases.slice(1)],
    };
    await act(async () => {
      screen.rerender(<DatabaseManagementSurface catalog={remoteCatalog} {...props} />);
      await Promise.resolve();
    });
    expect((screen.getByLabelText("View name Remote rename") as HTMLInputElement).value).toBe("Local draft");
    expect((screen.getByLabelText("View name Remote rename") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save View Remote rename" })).toBe(null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload View Remote rename" }));
      await Promise.resolve();
    });
    expect((screen.getByLabelText("View name Remote rename") as HTMLInputElement).value).toBe("Remote rename");
  });

  test("reorders durable Views with a logical anchor and captured CAS", async () => {
    const primary = catalog.databases[0];
    if (!primary) throw new Error("Missing primary Database fixture");
    const primaryView = primary.views[0];
    if (!primaryView) throw new Error("Missing primary View fixture");
    const reorderedCatalog: GeneralDatabaseCatalog = {
      databases: [{
        ...primary,
        views: [
          primaryView,
          {
            ...primaryView,
            id: "view-list",
            name: "List",
            kind: "list",
            isPrimary: false,
            revision: 2,
            rankKey: "2",
          },
        ],
      }],
    };
    const updates: unknown[] = [];
    const { DatabaseManagementSurface } = await import("./database-management-dialog");
    const screen = render(
      <DatabaseManagementSurface
        catalog={reorderedCatalog}
        cards={[]}
        selectedDatabaseBlockId="database-primary"
        onSelectDatabase={noop}
        onCreateDatabase={noop}
        onCreateProperty={noop}
        onDeleteProperty={noop}
        onCreateView={noop}
        onUpdateView={(draft) => {
          updates.push(draft);
        }}
        onDeleteView={noop}
        onSetMembership={noop}
        onPutPropertyOption={noop}
        onDeletePropertyOption={noop}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move View Board down" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(updates[0])).toBe(JSON.stringify({
      databaseBlockId: "database-primary",
      viewId: "view-primary",
      expectedRevision: 1,
      name: "Board",
      kind: "kanban",
      config: primaryView.config,
      beforeViewId: null,
    }));
  });
});
