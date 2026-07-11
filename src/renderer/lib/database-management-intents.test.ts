import { describe, expect, test } from "vitest";
import type {
  DatabaseMutationOperation,
  GeneralDatabaseViewConfig,
} from "../../shared/database-kernel";
import type {
  CardContentSummary,
  DatabaseReadSnapshot,
  DatabaseViewSnapshot,
  GeneralDatabaseDescriptor,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
  GeneralDatabaseViewDefinition,
} from "../../shared/database-query";
import {
  compileDatabaseManagementRequest,
  DatabaseManagementIntentError,
  type DatabaseManagementIntentErrorCode,
  type DatabaseManagementRequestContext,
} from "./database-management-intents";

const NOW = "2026-07-12T00:00:00.000Z";

const emptyViewConfig = (): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [
    {
      field: { kind: "manual" },
      direction: "asc",
      nulls: "last",
    },
  ],
  group: null,
  display: { propertyIds: [], showTitle: true },
});

const property = (input: {
  readonly databaseBlockId: string;
  readonly id: string;
  readonly key: string;
  readonly revision: number;
  readonly rankKey: string;
  readonly valueType?: GeneralDatabasePropertyDefinition["valueType"];
  readonly config?: GeneralDatabasePropertyDefinition["config"];
  readonly lifecycle?: GeneralDatabasePropertyDefinition["lifecycle"];
}): GeneralDatabasePropertyDefinition => ({
  id: input.id,
  databaseBlockId: input.databaseBlockId,
  key: input.key,
  name: input.key,
  valueType: input.valueType ?? "text",
  config: input.config ?? {},
  rankKey: input.rankKey,
  lifecycle: input.lifecycle ?? "active",
  revision: input.revision,
  createdAt: NOW,
  updatedAt: NOW,
});

const view = (input: {
  readonly projectId: string;
  readonly databaseBlockId: string;
  readonly id: string;
  readonly revision: number;
  readonly rankKey: string;
  readonly isPrimary?: boolean;
  readonly config?: GeneralDatabaseViewConfig;
  readonly lifecycle?: GeneralDatabaseViewDefinition["lifecycle"];
}): GeneralDatabaseViewDefinition => ({
  id: input.id,
  databaseBlockId: input.databaseBlockId,
  projectId: input.projectId,
  name: input.id,
  kind: input.id.includes("board") ? "kanban" : "list",
  config: input.config ?? emptyViewConfig(),
  isPrimary: input.isPrimary ?? false,
  revision: input.revision,
  rankKey: input.rankKey,
  lifecycle: input.lifecycle ?? "active",
  createdAt: NOW,
  updatedAt: NOW,
});

const descriptor = (
  databaseBlockId: string,
  projectId = "project-1",
): GeneralDatabaseDescriptor => ({
  database: {
    blockId: databaseBlockId,
    projectId,
    name: databaseBlockId,
    isPrimary: databaseBlockId === "database-a",
    schemaKey: "nodex.database",
    schemaRevision: databaseBlockId === "database-a" ? 11 : 6,
    metadataRevision: 9,
    createdAt: NOW,
    updatedAt: NOW,
  },
  properties: [
    property({
      databaseBlockId,
      id: `${databaseBlockId}-status`,
      key: "status",
      valueType: "select",
      config: {
        options: [
          { id: "todo", name: "Todo", color: "gray" },
          { id: "done", name: "Done", color: "green" },
        ],
      },
      revision: 3,
      rankKey: "a0",
    }),
    property({
      databaseBlockId,
      id: `${databaseBlockId}-notes`,
      key: "notes",
      revision: 4,
      rankKey: "a1",
    }),
    property({
      databaseBlockId,
      id: `${databaseBlockId}-retired`,
      key: "retired",
      revision: 2,
      rankKey: "z0",
      lifecycle: "deleted",
    }),
  ],
  views: [
    view({
      projectId,
      databaseBlockId,
      id: `${databaseBlockId}-board`,
      revision: 5,
      rankKey: "a0",
      isPrimary: true,
    }),
    view({
      projectId,
      databaseBlockId,
      id: `${databaseBlockId}-list`,
      revision: 2,
      rankKey: "a1",
    }),
    view({
      projectId,
      databaseBlockId,
      id: `${databaseBlockId}-retired-view`,
      revision: 3,
      rankKey: "z0",
      lifecycle: "deleted",
    }),
  ],
});

const descriptorSnapshot = (
  value: GeneralDatabaseDescriptor,
  changeLogSeq = 41,
): DatabaseReadSnapshot<GeneralDatabaseDescriptor> => ({
  version: 1,
  projectId: value.database.projectId,
  storeEpoch: "epoch-1",
  changeLogSeq,
  value,
});

const card = (
  blockId: string,
  projectId = "project-1",
): CardContentSummary => ({
  blockId,
  projectId,
  lifecycle: "active",
  location: { kind: "space", rankKey: "a0" },
  locationRevision: 1,
  metadataRevision: 1,
  documentId: `document-${blockId}`,
  documentGeneration: 1,
  documentHeadSeq: 1,
  documentAuthority: "ydoc_primary",
  content: {
    projectedSeq: 1,
    title: blockId,
    preview: "",
    plainText: "",
  },
  createdAt: NOW,
  updatedAt: NOW,
});

const row = (input: {
  readonly descriptor: GeneralDatabaseDescriptor;
  readonly cardBlockId: string;
  readonly membershipId: string;
  readonly membershipRevision: number;
  readonly groupKey?: string | null;
  readonly positioned?: boolean;
}): GeneralDatabaseRow => ({
  membership: {
    id: input.membershipId,
    databaseBlockId: input.descriptor.database.blockId,
    cardBlockId: input.cardBlockId,
    revision: input.membershipRevision,
    createdAt: NOW,
  },
  card: card(input.cardBlockId, input.descriptor.database.projectId),
  values: {},
  position:
    input.positioned === false
      ? null
      : {
          groupKey: input.groupKey ?? null,
          rankKey: "a0",
          revision: 2,
        },
  effectiveGroupKey: input.groupKey ?? null,
});

const viewSnapshot = (input: {
  readonly descriptor: GeneralDatabaseDescriptor;
  readonly viewId?: string;
  readonly rows?: readonly GeneralDatabaseRow[];
  readonly changeLogSeq?: number;
}): DatabaseViewSnapshot => {
  const selected = input.descriptor.views.find(
    (candidate) =>
      candidate.id ===
      (input.viewId ?? `${input.descriptor.database.blockId}-list`),
  );
  if (!selected) throw new Error("fixture View is missing");
  const changeLogSeq = input.changeLogSeq ?? 41;
  return {
    descriptor: descriptorSnapshot(input.descriptor, changeLogSeq),
    query: {
      version: 1,
      projectId: input.descriptor.database.projectId,
      storeEpoch: "epoch-1",
      changeLogSeq,
      value: {
        database: input.descriptor.database,
        view: selected,
        properties: input.descriptor.properties.filter(
          (candidate) => candidate.lifecycle === "active",
        ),
        rows: input.rows ?? [],
      },
    },
  };
};

const context = (): DatabaseManagementRequestContext => ({
  operationId: "operation-retained-by-caller",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "window-7",
  actor: { kind: "renderer_database_management" },
});

const operation = <Kind extends DatabaseMutationOperation["kind"]>(
  value: readonly DatabaseMutationOperation[],
  kind: Kind,
): Extract<DatabaseMutationOperation, { readonly kind: Kind }> => {
  const candidate = value[0];
  if (!candidate || candidate.kind !== kind) {
    throw new Error(`expected ${kind} operation`);
  }
  return candidate as Extract<
    DatabaseMutationOperation,
    { readonly kind: Kind }
  >;
};

const errorCode = (run: () => unknown): DatabaseManagementIntentErrorCode => {
  try {
    run();
  } catch (error) {
    if (error instanceof DatabaseManagementIntentError) return error.code;
    throw error;
  }
  throw new Error("expected Database management intent to fail");
};

describe("Database management intent compiler", () => {
  test("creates a secondary Database and initial View with caller retry identity and no client rank", () => {
    const request = compileDatabaseManagementRequest({
      context: context(),
      intent: {
        kind: "create_database",
        databaseBlockId: "database-b",
        name: "Research",
        beforeBlockId: "card-anchor",
        initialView: {
          id: "database-b-list",
          name: "All notes",
          kind: "list",
          config: emptyViewConfig(),
        },
      },
    });
    const created = operation(request.operations, "create_database");

    expect(request.operationId).toBe("operation-retained-by-caller");
    expect(request.clientSessionId).toBe("window-7");
    expect(created.isPrimary).toBe(false);
    expect(created.databaseBlockId).toBe("database-b");
    expect(created.initialView.viewId).toBe("database-b-list");
    expect(created.beforeBlockId).toBe("card-anchor");
    expect(JSON.stringify(request).includes("rankKey")).toBe(false);
  });

  test("puts and deletes typed properties with descriptor-derived CAS revisions and stable anchors", () => {
    const authority = descriptor("database-a");
    const snapshot = descriptorSnapshot(authority);
    const created = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "put_property",
          mode: "create",
          descriptor: snapshot,
          property: {
            id: "database-a-score",
            key: "score",
            name: "Score",
            valueType: "number",
            config: {},
          },
          beforePropertyId: "database-a-notes",
        },
      }).operations,
      "put_property",
    );
    const updated = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "put_property",
          mode: "update",
          descriptor: snapshot,
          property: {
            id: "database-a-status",
            key: "state",
            name: "State",
            valueType: "select",
            config: authority.properties[0]!.config,
          },
        },
      }).operations,
      "put_property",
    );
    const deleted = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "delete_property",
          descriptor: snapshot,
          propertyId: "database-a-notes",
        },
      }).operations,
      "delete_property",
    );

    expect(created.expectedDatabaseSchemaRevision).toBe(11);
    expect(created.expectedPropertyRevision).toBe(0);
    expect(created.beforePropertyId).toBe("database-a-notes");
    expect(updated.expectedDatabaseSchemaRevision).toBe(11);
    expect(updated.expectedPropertyRevision).toBe(3);
    expect(updated.beforePropertyId).toBe("database-a-notes");
    expect(deleted.expectedDatabaseSchemaRevision).toBe(11);
    expect(deleted.expectedPropertyRevision).toBe(4);
  });

  test("puts and deletes stable select options through the existing property operation", () => {
    const authority = descriptor("database-a");
    const snapshot = descriptorSnapshot(authority);
    const added = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "put_property_option",
          mode: "create",
          descriptor: snapshot,
          propertyId: "database-a-status",
          option: { id: "later", name: "Later", color: "blue" },
          beforeOptionId: "done",
        },
      }).operations,
      "put_property",
    );
    const updated = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "put_property_option",
          mode: "update",
          descriptor: snapshot,
          propertyId: "database-a-status",
          option: { id: "todo", name: "Next", color: "orange" },
        },
      }).operations,
      "put_property",
    );
    const deleted = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "delete_property_option",
          descriptor: snapshot,
          propertyId: "database-a-status",
          optionId: "done",
        },
      }).operations,
      "put_property",
    );

    expect(added.expectedDatabaseSchemaRevision).toBe(11);
    expect(added.expectedPropertyRevision).toBe(3);
    expect(added.beforePropertyId).toBe("database-a-notes");
    expect(JSON.stringify(added.config.options)).toBe(
      JSON.stringify([
        { id: "todo", name: "Todo", color: "gray" },
        { id: "later", name: "Later", color: "blue" },
        { id: "done", name: "Done", color: "green" },
      ]),
    );
    expect(JSON.stringify(updated.config.options)).toBe(
      JSON.stringify([
        { id: "todo", name: "Next", color: "orange" },
        { id: "done", name: "Done", color: "green" },
      ]),
    );
    expect(JSON.stringify(deleted.config.options)).toBe(
      JSON.stringify([{ id: "todo", name: "Todo", color: "gray" }]),
    );
  });

  test("creates, updates, and deletes Views with descriptor-derived revisions", () => {
    const authority = descriptor("database-a");
    const snapshot = descriptorSnapshot(authority);
    const propertyViewConfig: GeneralDatabaseViewConfig = {
      ...emptyViewConfig(),
      display: {
        propertyIds: ["database-a-status"],
        showTitle: true,
      },
    };
    const created = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "put_view",
          mode: "create",
          descriptor: snapshot,
          view: {
            id: "database-a-calendar",
            name: "Calendar",
            kind: "calendar",
            config: propertyViewConfig,
            isPrimary: false,
          },
          beforeViewId: "database-a-list",
        },
      }).operations,
      "put_view",
    );
    const updated = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "put_view",
          mode: "update",
          descriptor: snapshot,
          view: {
            id: "database-a-board",
            name: "Board renamed",
            kind: "kanban",
            config: emptyViewConfig(),
            isPrimary: true,
          },
        },
      }).operations,
      "put_view",
    );
    const deleted = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "delete_view",
          descriptor: snapshot,
          viewId: "database-a-list",
        },
      }).operations,
      "delete_view",
    );

    expect(created.expectedRevision).toBe(0);
    expect(created.beforeViewId).toBe("database-a-list");
    expect(updated.expectedRevision).toBe(5);
    expect(updated.beforeViewId).toBe("database-a-list");
    expect(deleted.expectedRevision).toBe(2);
  });

  test("adds and removes memberships with exact membership CAS and logical position anchors", () => {
    const targetDescriptor = descriptor("database-b");
    const targetAnchor = row({
      descriptor: targetDescriptor,
      cardBlockId: "card-b",
      membershipId: "membership-b",
      membershipRevision: 2,
    });
    const target = viewSnapshot({
      descriptor: targetDescriptor,
      rows: [targetAnchor],
    });
    const added = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "add_membership",
          card: card("card-new"),
          membershipId: "membership-new",
          target,
          beforeCardBlockId: "card-b",
        },
      }).operations,
      "transfer_membership",
    );
    const sourceDescriptor = descriptor("database-a");
    const sourceRow = row({
      descriptor: sourceDescriptor,
      cardBlockId: "card-a",
      membershipId: "membership-a",
      membershipRevision: 7,
    });
    const removed = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "remove_membership",
          cardBlockId: "card-a",
          source: viewSnapshot({
            descriptor: sourceDescriptor,
            rows: [sourceRow],
          }),
        },
      }).operations,
      "transfer_membership",
    );

    expect(JSON.stringify(added.expectedMembership)).toBe("null");
    expect(JSON.stringify(added.target)).toBe(
      JSON.stringify({
        databaseBlockId: "database-b",
        membershipId: "membership-new",
        viewId: "database-b-list",
        groupKey: null,
        beforeCardBlockId: "card-b",
      }),
    );
    expect(JSON.stringify(removed.expectedMembership)).toBe(
      JSON.stringify({ membershipId: "membership-a", revision: 7 }),
    );
    expect(removed.target).toBe(null);
    expect(JSON.stringify(added).includes("rankKey")).toBe(false);
  });

  test("transfers one Card between Database authorities captured at one cursor", () => {
    const sourceDescriptor = descriptor("database-a");
    const targetDescriptor = descriptor("database-b");
    const sourceRow = row({
      descriptor: sourceDescriptor,
      cardBlockId: "card-a",
      membershipId: "membership-a",
      membershipRevision: 7,
    });
    const targetAnchor = row({
      descriptor: targetDescriptor,
      cardBlockId: "card-b",
      membershipId: "membership-b",
      membershipRevision: 2,
    });
    const transferred = operation(
      compileDatabaseManagementRequest({
        context: context(),
        intent: {
          kind: "transfer_membership",
          cardBlockId: "card-a",
          membershipId: "membership-a-in-b",
          source: viewSnapshot({
            descriptor: sourceDescriptor,
            rows: [sourceRow],
          }),
          target: viewSnapshot({
            descriptor: targetDescriptor,
            rows: [targetAnchor],
          }),
          beforeCardBlockId: "card-b",
        },
      }).operations,
      "transfer_membership",
    );

    expect(JSON.stringify(transferred.expectedMembership)).toBe(
      JSON.stringify({ membershipId: "membership-a", revision: 7 }),
    );
    expect(JSON.stringify(transferred.target)).toBe(
      JSON.stringify({
        databaseBlockId: "database-b",
        membershipId: "membership-a-in-b",
        viewId: "database-b-list",
        groupKey: null,
        beforeCardBlockId: "card-b",
      }),
    );
  });

  test("rejects stale scopes, foreign property references, unsupported option owners, and invalid membership targets", () => {
    const authority = descriptor("database-a");
    const snapshot = descriptorSnapshot(authority);
    const targetDescriptor = descriptor("database-b");
    const unpositionedAnchor = row({
      descriptor: targetDescriptor,
      cardBlockId: "card-b",
      membershipId: "membership-b",
      membershipRevision: 2,
      positioned: false,
    });

    expect(
      errorCode(() =>
        compileDatabaseManagementRequest({
          context: { ...context(), storeEpoch: "another-epoch" },
          intent: {
            kind: "delete_property",
            descriptor: snapshot,
            propertyId: "database-a-notes",
          },
        }),
      ),
    ).toBe("authority_scope_mismatch");
    expect(
      errorCode(() =>
        compileDatabaseManagementRequest({
          context: context(),
          intent: {
            kind: "put_view",
            mode: "create",
            descriptor: snapshot,
            view: {
              id: "database-a-foreign-view",
              name: "Foreign",
              kind: "list",
              config: {
                ...emptyViewConfig(),
                display: {
                  propertyIds: ["foreign-property"],
                  showTitle: true,
                },
              },
              isPrimary: false,
            },
          },
        }),
      ),
    ).toBe("view_property_not_found");
    expect(
      errorCode(() =>
        compileDatabaseManagementRequest({
          context: context(),
          intent: {
            kind: "put_property_option",
            mode: "create",
            descriptor: snapshot,
            propertyId: "database-a-notes",
            option: { id: "choice", name: "Choice" },
          },
        }),
      ),
    ).toBe("property_type_invalid");
    expect(
      errorCode(() =>
        compileDatabaseManagementRequest({
          context: context(),
          intent: {
            kind: "add_membership",
            card: card("card-new"),
            membershipId: "membership-new",
            target: viewSnapshot({
              descriptor: targetDescriptor,
              rows: [unpositionedAnchor],
            }),
            beforeCardBlockId: "card-b",
          },
        }),
      ),
    ).toBe("membership_anchor_not_found");
    expect(
      errorCode(() =>
        compileDatabaseManagementRequest({
          context: context(),
          intent: {
            kind: "add_membership",
            card: card("card-new"),
            membershipId: "membership-new",
            target: viewSnapshot({ descriptor: targetDescriptor }),
            groupKey: "todo",
          },
        }),
      ),
    ).toBe("membership_group_invalid");
  });

  test("rejects cross-cursor transfers instead of guessing target authority", () => {
    const sourceDescriptor = descriptor("database-a");
    const targetDescriptor = descriptor("database-b");
    const sourceRow = row({
      descriptor: sourceDescriptor,
      cardBlockId: "card-a",
      membershipId: "membership-a",
      membershipRevision: 7,
    });

    expect(
      errorCode(() =>
        compileDatabaseManagementRequest({
          context: context(),
          intent: {
            kind: "transfer_membership",
            cardBlockId: "card-a",
            membershipId: "membership-a-in-b",
            source: viewSnapshot({
              descriptor: sourceDescriptor,
              rows: [sourceRow],
              changeLogSeq: 41,
            }),
            target: viewSnapshot({
              descriptor: targetDescriptor,
              changeLogSeq: 42,
            }),
          },
        }),
      ),
    ).toBe("authority_cursor_mismatch");
  });
});
