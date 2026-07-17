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
} from "./database-module-v2-transport";

const CUSTOM_PROPERTY_ID = "p_abcdefgh";
const CUSTOM_OPTION_ID = "o_abcdefgh";

const applyRequest = () => ({
  version: 2,
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
      valueType: "multi_select",
      config: {},
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
      kind: "add_remove_value",
      pageId: "page-1",
      dataSourceId: "source-1",
      propertyId: CUSTOM_PROPERTY_ID,
      add: [CUSTOM_OPTION_ID],
      remove: [],
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
  valueType: "multi_select",
  config: {
    options: [{ id: CUSTOM_OPTION_ID, name: "Platform", color: "blue" }],
  },
  rankKey: "a",
  lifecycle: "active",
  revision: 2,
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
});

describe("Database Module v2 transport boundary", () => {
  test("is additive and keeps the active v1 contract untouched", () => {
    expect(DATABASE_MODULE_CONTRACT_VERSION).toBe(1);
    expect(DATABASE_MODULE_V2_CONTRACT_VERSION).toBe(2);
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
      "add_remove_value",
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
            valueType: "select",
            config: {},
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
      config: {},
    });
  });

  test("rejects inline option registries and the removed Property key", () => {
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
    ).toThrow("use put_option or delete_option");

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

  test("validates v2 View Property references on ad hoc reads", () => {
    expect(
      bindDatabaseModuleReadV2(
        {
          version: 2,
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
    ).toMatchObject({ read: { mode: "query" } });

    expect(() =>
      bindDatabaseModuleReadV2(
        {
          version: 2,
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
    ).toThrow("propertyId must be a reserved built-in ID");
  });

  test("parses stored option registries while rejecting the removed key field", () => {
    const result = {
      ok: true,
      value: {
        version: 2,
        projectId: "project-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 4,
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
        version: 2,
        operationId: "operation-1",
        projectId: "project-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        duplicate: false,
        operationKinds: ["put_option", "add_remove_value"],
        affectedDatabaseIds: ["database-1"],
        affectedDataSourceIds: ["source-1"],
        affectedPageIds: ["page-1"],
        affectedViewIds: ["view-1"],
        committedRevisions: { [`property:${CUSTOM_PROPERTY_ID}`]: 2 },
        changeLogSeq: 5,
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
});
