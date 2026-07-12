import { describe, expect, test } from "vitest";
import type {
  DatabaseMutationOperation,
  GeneralDatabaseViewConfig,
} from "../../shared/database-kernel";
import type {
  CardContentSummary,
  DatabaseReadSnapshot,
  GeneralDatabaseManagement,
  GeneralDatabaseMembershipState,
  GeneralDatabaseDescriptor,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseViewDefinition,
} from "../../shared/database-query";
import {
  compileDatabaseManagementRequest,
  compileDatabaseMembershipTransferIntent,
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

const membershipState = (input: {
  readonly descriptor: GeneralDatabaseDescriptor;
  readonly cardBlockId: string;
  readonly membershipId?: string;
  readonly membershipRevision?: number;
  readonly groupKey?: string | null;
  readonly positioned?: boolean;
}): GeneralDatabaseMembershipState => ({
  card: {
    ...card(input.cardBlockId, input.descriptor.database.projectId),
    ...(input.membershipId
      ? {
          location: {
            kind: "database" as const,
            databaseBlockId: input.descriptor.database.blockId,
          },
        }
      : {}),
  },
  membership: input.membershipId
    ? {
        id: input.membershipId,
        databaseBlockId: input.descriptor.database.blockId,
        cardBlockId: input.cardBlockId,
        revision: input.membershipRevision ?? 1,
        createdAt: NOW,
      }
    : null,
  positions: input.membershipId && input.positioned !== false
    ? [
        {
          viewId: `${input.descriptor.database.blockId}-list`,
          groupKey: input.groupKey ?? null,
          rankKey: "a0",
          revision: 2,
        },
      ]
    : [],
});

const managementSnapshot = (input: {
  readonly descriptors: readonly GeneralDatabaseDescriptor[];
  readonly cards: readonly GeneralDatabaseMembershipState[];
  readonly changeLogSeq?: number;
}): DatabaseReadSnapshot<GeneralDatabaseManagement> => ({
  version: 1,
  projectId: input.descriptors[0]?.database.projectId ?? "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: input.changeLogSeq ?? 41,
  value: {
    catalog: { databases: input.descriptors },
    cards: input.cards,
  },
});

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
          expectedRevision: 4,
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
    expect(updated.expectedRevision).toBe(4);
    expect(updated.beforeViewId).toBe("database-a-list");
    expect(deleted.expectedRevision).toBe(2);
  });

  test("adds and removes memberships with exact membership CAS and logical position anchors", () => {
    const sourceDescriptor = descriptor("database-a");
    const targetDescriptor = descriptor("database-b");
    const targetAnchor = membershipState({
      descriptor: targetDescriptor,
      cardBlockId: "card-b",
      membershipId: "membership-b",
      membershipRevision: 2,
    });
    const newCard = membershipState({
      descriptor: targetDescriptor,
      cardBlockId: "card-new",
    });
    const authority = managementSnapshot({
      descriptors: [sourceDescriptor, targetDescriptor],
      cards: [newCard, targetAnchor],
    });
    const added = compileDatabaseMembershipTransferIntent({
      context: context(),
      intent: {
        kind: "set_membership",
        authority,
        cardBlockId: "card-new",
        target: {
          databaseBlockId: "database-b",
          viewId: "database-b-list",
          beforeCardBlockId: "card-b",
        },
      },
    });
    const sourceState = membershipState({
      descriptor: sourceDescriptor,
      cardBlockId: "card-a",
      membershipId: "membership-a",
      membershipRevision: 7,
    });
    const removed = compileDatabaseMembershipTransferIntent({
      context: context(),
      intent: {
        kind: "set_membership",
        authority: managementSnapshot({
          descriptors: [sourceDescriptor, targetDescriptor],
          cards: [sourceState, targetAnchor],
        }),
        cardBlockId: "card-a",
        target: null,
      },
    });

    expect(added.source).toEqual({ kind: "space" });
    expect(JSON.stringify(added.target)).toBe(
      JSON.stringify({
        kind: "database",
        databaseBlockId: "database-b",
        viewId: "database-b-list",
        groupKey: null,
        beforeCardBlockId: "card-b",
      }),
    );
    expect(removed.source).toEqual({
      kind: "database",
      databaseBlockId: "database-a",
    });
    expect(removed.target).toEqual({ kind: "space" });
    expect(JSON.stringify(added).includes("rankKey")).toBe(false);
  });

  test("transfers one Card between Database authorities captured at one cursor", () => {
    const sourceDescriptor = descriptor("database-a");
    const targetDescriptor = descriptor("database-b");
    const sourceState = membershipState({
      descriptor: sourceDescriptor,
      cardBlockId: "card-a",
      membershipId: "membership-a",
      membershipRevision: 7,
    });
    const targetAnchor = membershipState({
      descriptor: targetDescriptor,
      cardBlockId: "card-b",
      membershipId: "membership-b",
      membershipRevision: 2,
    });
    const transferred = compileDatabaseMembershipTransferIntent({
      context: context(),
      intent: {
        kind: "set_membership",
        authority: managementSnapshot({
          descriptors: [sourceDescriptor, targetDescriptor],
          cards: [sourceState, targetAnchor],
        }),
        cardBlockId: "card-a",
        target: {
          databaseBlockId: "database-b",
          viewId: "database-b-list",
          beforeCardBlockId: "card-b",
        },
      },
    });

    expect(transferred.source).toEqual({
      kind: "database",
      databaseBlockId: "database-a",
    });
    expect(JSON.stringify(transferred.target)).toBe(
      JSON.stringify({
        kind: "database",
        databaseBlockId: "database-b",
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
    const unpositionedAnchor = membershipState({
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
        compileDatabaseMembershipTransferIntent({
          context: context(),
          intent: {
            kind: "set_membership",
            authority: managementSnapshot({
              descriptors: [authority, targetDescriptor],
              cards: [
                membershipState({
                  descriptor: targetDescriptor,
                  cardBlockId: "card-new",
                }),
                unpositionedAnchor,
              ],
            }),
            cardBlockId: "card-new",
            target: {
              databaseBlockId: "database-b",
              viewId: "database-b-list",
              beforeCardBlockId: "card-b",
            },
          },
        }),
      ),
    ).toBe("membership_anchor_not_found");
    expect(
      errorCode(() =>
        compileDatabaseMembershipTransferIntent({
          context: context(),
          intent: {
            kind: "set_membership",
            authority: managementSnapshot({
              descriptors: [authority, targetDescriptor],
              cards: [
                membershipState({
                  descriptor: targetDescriptor,
                  cardBlockId: "card-new",
                }),
              ],
            }),
            cardBlockId: "card-new",
            target: {
              databaseBlockId: "database-b",
              viewId: "database-b-list",
              groupKey: "todo",
            },
          },
        }),
      ),
    ).toBe("membership_group_invalid");
  });

  test("rejects stale management authority instead of guessing membership state", () => {
    const sourceDescriptor = descriptor("database-a");
    const targetDescriptor = descriptor("database-b");
    const sourceState = membershipState({
      descriptor: sourceDescriptor,
      cardBlockId: "card-a",
      membershipId: "membership-a",
      membershipRevision: 7,
    });

    expect(
      errorCode(() =>
        compileDatabaseMembershipTransferIntent({
          context: { ...context(), storeEpoch: "epoch-new" },
          intent: {
            kind: "set_membership",
            authority: managementSnapshot({
              descriptors: [sourceDescriptor, targetDescriptor],
              cards: [sourceState],
            }),
            cardBlockId: "card-a",
            target: {
              databaseBlockId: "database-b",
              viewId: "database-b-list",
            },
          },
        }),
      ),
    ).toBe("authority_scope_mismatch");
  });
});
