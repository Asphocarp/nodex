import { describe, expect, test } from "vitest";
import { DATABASE_MODULE_CONTRACT_VERSION } from "./database-module";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "./database-module-v2";
import {
  bindDatabaseApplyV2,
  bindDatabaseModuleReadV2,
  databaseModuleFailureV2,
  databaseModuleHttpStatusV2,
  parseDatabaseApplyResultV2,
  parseDatabaseModuleReadResultV2,
  parseLibraryDatabaseApplyResultV2,
  parseLibraryDatabaseModuleReadResultV2,
} from "./database-module-v2-transport";

const CUSTOM_PROPERTY_ID = "p_abcdefgh";
const CUSTOM_OPTION_ID = "o_abcdefgh";

const applyRequest = () => ({
  version: DATABASE_MODULE_V2_CONTRACT_VERSION,
  operationId: "module-operation-2",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  actor: { kind: "spoofed-renderer" },
  operations: [
    {
      kind: "put_property",
      dataSourceId: "source-1",
      propertyId: CUSTOM_PROPERTY_ID,
      expectedDataSourceRevision: 1,
      expectedPropertyRevision: 0,
      name: "Teams",
      schema: { kind: "multi_select" },
    },
    {
      kind: "put_option",
      dataSourceId: "source-1",
      propertyId: CUSTOM_PROPERTY_ID,
      optionId: CUSTOM_OPTION_ID,
      name: "Platform",
      color: "blue",
      expectedPropertyRevision: 0,
    },
    {
      kind: "edit_property_values",
      edits: [{
        pageId: "page-1",
        dataSourceId: "source-1",
        propertyId: CUSTOM_PROPERTY_ID,
        edit: {
          kind: "patch_set",
          delta: {
            kind: "multi_select",
            addOptionIds: [CUSTOM_OPTION_ID],
            removeOptionIds: [],
          },
        },
      }],
    },
  ],
});

const dataSourceRecord = () => ({
  dataSourceId: "source-1",
  libraryId: "library-1",
  homeDatabaseId: "database-1",
  name: "Tasks",
  schemaKey: "tasks",
  schemaRevision: 2,
  lifecycle: "active",
  rankKey: "a",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
});

const propertyRecord = () => ({
  propertyId: CUSTOM_PROPERTY_ID,
  dataSourceId: "source-1",
  name: "Teams",
  schema: { kind: "multi_select" },
  capabilities: {
    replace: true,
    patchSetMember: "option",
    filterOperators: ["contains", "not_contains", "is_empty", "is_not_empty"],
    sortable: true,
    groupable: true,
  },
  valueType: "multi_select",
  config: {},
  optionCount: 1,
  rankKey: "a",
  lifecycle: "active",
  revision: 2,
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
});

describe("Database Module v2 transport boundary", () => {
  test("is additive and keeps the active v1 contract untouched", () => {
    expect(DATABASE_MODULE_CONTRACT_VERSION).toBe(1);
    expect(DATABASE_MODULE_V2_CONTRACT_VERSION).toBe(4);
  });

  test("binds ordered option creation and value writes under one apply", () => {
    const bound = bindDatabaseApplyV2(applyRequest(), "project-1", {
      actor: { kind: "electron_renderer", clientId: "window-1" },
    });

    expect(bound.actor).toEqual({
      kind: "electron_renderer",
      clientId: "window-1",
    });
    expect(bound.operations.map((operation) => operation.kind)).toEqual([
      "put_property",
      "put_option",
      "edit_property_values",
    ]);
    expect(bound.operations[1]).toMatchObject({
      propertyId: CUSTOM_PROPERTY_ID,
      optionId: CUSTOM_OPTION_ID,
      expectedPropertyRevision: 0,
    });
  });

  test("represents select creation and updates without carrying option membership", () => {
    const request = applyRequest();
    const bound = bindDatabaseApplyV2(
      {
        ...request,
        operations: [
          {
            kind: "put_property",
            dataSourceId: "source-1",
            propertyId: "status",
            expectedDataSourceRevision: 2,
            expectedPropertyRevision: 3,
            name: "Workflow",
            schema: { kind: "select" },
          },
        ],
      },
      "project-1",
      { actor: { kind: "test" } },
    );

    expect(bound.operations[0]).toMatchObject({
      kind: "put_property",
      propertyId: "status",
      expectedPropertyRevision: 3,
      schema: { kind: "select" },
    });
  });

  test("rejects a reserved Property with a non-canonical value type", () => {
    const request = applyRequest();
    expect(() => bindDatabaseApplyV2(
      {
        ...request,
        operations: [{
          kind: "put_property",
          dataSourceId: "source-1",
          propertyId: "status",
          expectedDataSourceRevision: 2,
          expectedPropertyRevision: 3,
          name: "Workflow",
          schema: { kind: "multi_select" },
        }],
      },
      "project-1",
      { actor: { kind: "test" } },
    )).toThrow("reserved Property status must use select");
  });

  test("rejects legacy inline config and the removed Property key", () => {
    const request = applyRequest();
    const property = request.operations[0];

    expect(() =>
      bindDatabaseApplyV2(
        {
          ...request,
          operations: [
            {
              ...property,
              config: {
                options: [{ id: CUSTOM_OPTION_ID, name: "Platform" }],
              },
            },
          ],
        },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow(".config is not supported");

    expect(() =>
      bindDatabaseApplyV2(
        {
          ...request,
          operations: [{ ...property, key: "teams" }],
        },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow(".key is not supported");
  });

  test("enforces compact Property IDs and owner-scoped option IDs", () => {
    const request = applyRequest();

    expect(() =>
      bindDatabaseApplyV2(
        {
          ...request,
          operations: [
            {
              ...request.operations[1],
              propertyId: "status",
              optionId: CUSTOM_OPTION_ID,
            },
          ],
        },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow("invalid for Property status");

    expect(() =>
      bindDatabaseApplyV2(
        {
          ...request,
          operations: [
            {
              ...request.operations[0],
              propertyId:
                "database:db:primary:property:database:db:primary:property:tags",
            },
          ],
        },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow("propertyId is invalid");
  });

  test("attests route scope, version, and exact request fields", () => {
    const request = applyRequest();
    expect(() =>
      bindDatabaseApplyV2(request, "project-2", {
        actor: { kind: "test" },
      }),
    ).toThrow("does not match its Project route scope");
    expect(() =>
      bindDatabaseApplyV2(
        { ...request, version: 1 },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow("Unsupported Database Module v2 contract version");
    expect(() =>
      bindDatabaseApplyV2(
        { ...request, databaseBlockId: "block-1" },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow("databaseApplyV2.databaseBlockId is not supported");
  });

  test("rejects removed ad hoc query reads at the transport boundary", () => {
    expect(() =>
      bindDatabaseModuleReadV2(
        {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId: "project-1",
          read: {
            target: { kind: "data_source", dataSourceId: "source-1" },
            mode: "query",
            filter: {
              kind: "clause",
              propertyId: CUSTOM_PROPERTY_ID,
              operator: "equals",
              value: CUSTOM_OPTION_ID,
            },
          },
        },
        "project-1",
      ),
    ).toThrow("target and mode are incompatible");

    expect(() =>
      bindDatabaseModuleReadV2(
        {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId: "project-1",
          read: {
            target: { kind: "data_source", dataSourceId: "source-1" },
            mode: "query",
            sort: [
              {
                field: {
                  kind: "property",
                  propertyId: "database:db:primary:property:tags",
                },
                direction: "asc",
                nulls: "last",
              },
            ],
          },
        },
        "project-1",
      ),
    ).toThrow("target and mode are incompatible");
  });

  test("binds catalog and source-scoped Relation candidate windows", () => {
    expect(bindDatabaseModuleReadV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: "project-1",
      read: {
        target: { kind: "project_default" },
        mode: "catalog_window",
        window: { first: 100 },
      },
    }, "project-1").read.mode).toBe("catalog_window");

    expect(bindDatabaseModuleReadV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: "project-1",
      read: {
        target: { kind: "data_source", dataSourceId: "source-1" },
        mode: "relation_candidate_window",
        query: "blocked",
        window: { first: 25 },
      },
    }, "project-1").read).toMatchObject({
      mode: "relation_candidate_window",
      query: "blocked",
      window: { first: 25 },
    });

    const unfiltered = bindDatabaseModuleReadV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: "project-1",
      read: {
        target: { kind: "data_source", dataSourceId: "source-1" },
        mode: "relation_candidate_window",
        window: { first: 25 },
      },
    }, "project-1").read;
    expect(unfiltered.mode).toBe("relation_candidate_window");
    expect("query" in unfiltered).toBe(false);
    expect(() => bindDatabaseModuleReadV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: "project-1",
      read: {
        target: { kind: "data_source", dataSourceId: "source-1" },
        mode: "relation_candidate_window",
        query: "",
      },
    }, "project-1")).toThrow(
      "databaseModuleReadV2.read.query must be a canonical non-empty string",
    );
    expect(() => bindDatabaseModuleReadV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: "project-1",
      read: {
        target: { kind: "data_source", dataSourceId: "source-1" },
        mode: "relation_candidate_window",
        query: "€".repeat(171),
      },
    }, "project-1")).toThrow(
      "databaseModuleReadV2.read.query must be at most 512 UTF-8 bytes",
    );
  });

  test("matches Core Relation replacement and patch cardinality limits", () => {
    const replacementIds = Array.from(
      { length: 101 },
      (_, index) => `page-${index}`,
    );
    const replacement = bindDatabaseApplyV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: "relation-replace",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: {},
      operations: [{
        kind: "edit_property_values",
        edits: [{
          pageId: "page-source",
          dataSourceId: "source-1",
          propertyId: CUSTOM_PROPERTY_ID,
          edit: {
            kind: "replace",
            expectedValueRevision: 1,
            value: { kind: "relation", pageIds: replacementIds },
          },
        }],
      }],
    }, "project-1", { actor: { kind: "test" } });
    expect(
      replacement.operations[0]?.kind === "edit_property_values"
        ? replacement.operations[0].edits[0]?.edit.kind === "replace"
          ? replacement.operations[0].edits[0].edit.value
          : null
        : null,
    ).toMatchObject({ kind: "relation", pageIds: replacementIds });

    expect(() => bindDatabaseApplyV2({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: "relation-patch",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: {},
      operations: [{
        kind: "edit_property_values",
        edits: [{
          pageId: "page-source",
          dataSourceId: "source-1",
          propertyId: CUSTOM_PROPERTY_ID,
          edit: {
            kind: "patch_set",
            delta: {
              kind: "relation",
              addPageIds: Array.from({ length: 60 }, (_, index) => `add-${index}`),
              removePageIds: Array.from({ length: 41 }, (_, index) => `remove-${index}`),
            },
          },
        }],
      }],
    }, "project-1", { actor: { kind: "test" } })).toThrow(
      "may change at most 100 Relation targets",
    );
  });

  test("parses typed Property descriptors while rejecting the removed key field", () => {
    const result = {
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: "project-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        commitSeq: 4,
        value: {
          kind: "data_source",
          value: {
            dataSource: dataSourceRecord(),
            properties: [propertyRecord()],
          },
        },
      },
    };

    expect(parseDatabaseModuleReadResultV2(result)).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "data_source",
          value: {
            properties: [{ propertyId: CUSTOM_PROPERTY_ID }],
          },
        },
      },
    });
    expect(() =>
      parseDatabaseModuleReadResultV2({
        ...result,
        value: {
          ...result.value,
          value: {
            kind: "data_source",
            value: {
              dataSource: dataSourceRecord(),
              properties: [{ ...propertyRecord(), key: "teams" }],
            },
          },
        },
      }),
    ).toThrow(".key is not supported");
  });

  test("round-trips identity conflicts and validates strict apply receipts", () => {
    const conflict = databaseModuleFailureV2(
      "identity_conflict",
      "Property identity is already owned",
      "operation-1",
    );
    expect(databaseModuleHttpStatusV2(conflict)).toBe(409);
    expect(
      parseDatabaseApplyResultV2({ ok: false, error: conflict }),
    ).toEqual({ ok: false, error: conflict });

    const receipt = {
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: "operation-1",
        projectId: "project-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        duplicate: false,
        operationKinds: ["put_option", "edit_property_values"],
        affectedDatabaseIds: ["database-1"],
        affectedDataSourceIds: ["source-1"],
        affectedPageIds: ["page-1"],
        affectedViewIds: ["view-1"],
        committedRevisions: { [`property:${CUSTOM_PROPERTY_ID}`]: 2 },
        commitSeq: 5,
        committedAt: "2026-07-18T00:00:00.000Z",
      },
    };
    expect(parseDatabaseApplyResultV2(receipt)).toMatchObject({ ok: true });
    expect(() =>
      parseDatabaseApplyResultV2({
        ...receipt,
        value: {
          ...receipt.value,
          affectedDataSourceIds: ["source-1", "source-1"],
        },
      }),
    ).toThrow("must contain unique identities");
  });

  test("keeps compatibility Project identity out of Library read and write receipts", () => {
    const read = parseLibraryDatabaseModuleReadResultV2({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        accessContext: { kind: "library" },
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        commitSeq: 4,
        value: {
          kind: "data_source",
          value: {
            dataSource: dataSourceRecord(),
            properties: [propertyRecord()],
          },
        },
      },
    });
    expect(read).toMatchObject({
      ok: true,
      value: { accessContext: { kind: "library" } },
    });
    if (read.ok) expect("projectId" in read.value).toBe(false);

    const apply = parseLibraryDatabaseApplyResultV2({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: "operation-1",
        accessContext: { kind: "library" },
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        duplicate: false,
        operationKinds: ["put_option"],
        affectedDatabaseIds: ["database-1"],
        affectedDataSourceIds: ["source-1"],
        affectedPageIds: [],
        affectedViewIds: [],
        committedRevisions: {},
        commitSeq: 5,
        committedAt: "2026-07-18T00:00:00.000Z",
      },
    });
    expect(apply).toMatchObject({
      ok: true,
      value: { accessContext: { kind: "library" } },
    });
    if (apply.ok) expect("projectId" in apply.value).toBe(false);
  });
});
