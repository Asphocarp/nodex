import { describe, expect, test } from "vitest";
import type { DatabaseApply } from "./database-module";
import {
  bindDatabaseApply,
  bindDatabaseModuleRead,
  parseDatabaseApplyResult,
  parseDatabaseModuleReadResult,
} from "./database-module-transport";

const applyRequest = (): DatabaseApply => ({
  version: 1,
  operationId: "module-operation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  actor: { kind: "spoofed-renderer" },
  operations: [
    {
      kind: "put_property",
      dataSourceId: "source-1",
      propertyId: "property-1",
      expectedDataSourceRevision: 1,
      expectedPropertyRevision: 0,
      key: "status",
      name: "Status",
      valueType: "select",
      config: { options: [{ id: "todo", name: "Todo" }] },
    },
    {
      kind: "put_view",
      databaseId: "database-1",
      dataSourceId: "source-1",
      viewId: "view-1",
      expectedRevision: 0,
      name: "All pages",
      viewKind: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
        group: null,
        display: { propertyIds: ["property-1"], showTitle: true },
      },
      isDefault: true,
    },
  ],
});

describe("Database Module transport contract", () => {
  test("attests route scope and replaces spoofable actor identity", () => {
    const bound = bindDatabaseApply(applyRequest(), "project-1", {
      actor: { kind: "electron_renderer", clientId: "window-1" },
    });
    expect(bound.actor).toEqual({
      kind: "electron_renderer",
      clientId: "window-1",
    });
    expect(bound.operations).toHaveLength(2);

    expect(() =>
      bindDatabaseApply(applyRequest(), "project-2", {
        actor: { kind: "electron_renderer" },
      }),
    ).toThrow("does not match its Project route scope");
  });

  test("rejects non-object property configs and non-boolean View defaults", () => {
    const request = applyRequest();
    expect(() =>
      bindDatabaseApply(
        {
          ...request,
          operations: [{ ...request.operations[0], config: [] }],
        },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow("must be a JSON object");
    expect(() =>
      bindDatabaseApply(
        {
          ...request,
          operations: [
            { ...request.operations[1], isDefault: "yes" },
          ],
        },
        "project-1",
        { actor: { kind: "test" } },
      ),
    ).toThrow("must be a boolean");
  });

  test("binds bulk, set-like Page values and View positions without Card coordinates", () => {
    const bound = bindDatabaseApply({
      version: 1,
      operationId: "bulk-page-drag",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: { kind: "spoofed" },
      operations: [
        {
          kind: "set_values",
          values: [{
            pageId: "page-1",
            dataSourceId: "source-1",
            propertyId: "status",
            expectedValueRevision: 2,
            value: "done",
          }],
        },
        {
          kind: "position_pages",
          viewId: "view-1",
          pages: [{ pageId: "page-1", expectedPositionRevision: 3 }],
          groupKey: "done",
          beforePageId: "page-2",
        },
        {
          kind: "add_remove_value",
          pageId: "page-1",
          dataSourceId: "source-1",
          propertyId: "tags",
          add: ["next"],
          remove: ["old"],
        },
      ],
    }, "project-1", { actor: { kind: "http" } });

    expect(bound.operations).toEqual([
      {
        kind: "set_values",
        values: [{
          pageId: "page-1",
          dataSourceId: "source-1",
          propertyId: "status",
          expectedValueRevision: 2,
          value: "done",
        }],
      },
      {
        kind: "position_pages",
        viewId: "view-1",
        pages: [{ pageId: "page-1", expectedPositionRevision: 3 }],
        groupKey: "done",
        beforePageId: "page-2",
      },
      {
        kind: "add_remove_value",
        pageId: "page-1",
        dataSourceId: "source-1",
        propertyId: "tags",
        add: ["next"],
        remove: ["old"],
      },
    ]);
  });

  test("binds every exclusive Page parent without client-owned membership IDs", () => {
    const bound = bindDatabaseApply({
      version: 1,
      operationId: "transfer-pages",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: { kind: "spoofed" },
      operations: [
        {
          kind: "transfer_page",
          pageId: "page-1",
          expectedParentRevision: 2,
          expectedActiveMembershipRevision: 1,
          target: { kind: "page", pageId: "page-parent" },
        },
        {
          kind: "transfer_page",
          pageId: "page-2",
          expectedParentRevision: 3,
          expectedActiveMembershipRevision: 0,
          target: {
            kind: "data_source",
            dataSourceId: "source-1",
            membershipId: "spoofed-membership",
          },
        },
      ],
    }, "project-1", { actor: { kind: "http" } });

    expect(bound.operations).toEqual([
      {
        kind: "transfer_page",
        pageId: "page-1",
        expectedParentRevision: 2,
        expectedActiveMembershipRevision: 1,
        target: { kind: "page", pageId: "page-parent" },
      },
      {
        kind: "transfer_page",
        pageId: "page-2",
        expectedParentRevision: 3,
        expectedActiveMembershipRevision: 0,
        target: { kind: "data_source", dataSourceId: "source-1" },
      },
    ]);
  });

  test("rejects ambiguous set-like value intents", () => {
    const request = applyRequest();
    expect(() => bindDatabaseApply({
      ...request,
      operations: [{
        kind: "add_remove_value",
        pageId: "page-1",
        dataSourceId: "source-1",
        propertyId: "tags",
        add: ["same"],
        remove: ["same"],
      }],
    }, "project-1", { actor: { kind: "test" } })).toThrow(
      "add and remove must be disjoint",
    );
  });

  test("retains null as the explicit append anchor for a View", () => {
    const request = applyRequest();
    const view = request.operations[1];
    if (view?.kind !== "put_view") throw new Error("Missing View fixture");
    const bound = bindDatabaseApply({
      ...request,
      operations: [{ ...view, beforeViewId: null }],
    }, "project-1", { actor: { kind: "test" } });
    expect(bound.operations[0]).toMatchObject({
      kind: "put_view",
      beforeViewId: null,
    });
  });

  test("requires compatible read targets and modes", () => {
    expect(
      bindDatabaseModuleRead(
        {
          version: 1,
          projectId: "project-1",
          read: {
            target: { kind: "data_source", dataSourceId: "source-1" },
            mode: "data_source",
          },
        },
        "project-1",
      ),
    ).toMatchObject({ read: { mode: "data_source" } });
    expect(
      bindDatabaseModuleRead(
        {
          version: 1,
          projectId: "project-1",
          read: {
            target: { kind: "data_source", dataSourceId: "source-1" },
            mode: "query",
            filter: { kind: "group", operator: "and", children: [] },
            sort: [{
              field: { kind: "title" },
              direction: "asc",
              nulls: "last",
            }],
          },
        },
        "project-1",
      ),
    ).toMatchObject({
      read: {
        mode: "query",
        target: { kind: "data_source", dataSourceId: "source-1" },
      },
    });
    expect(() => bindDatabaseModuleRead({
      version: 1,
      projectId: "project-1",
      read: {
        target: { kind: "data_source", dataSourceId: "source-1" },
        mode: "query",
        sort: [{
          field: { kind: "manual" },
          direction: "asc",
          nulls: "last",
        }],
      },
    }, "project-1")).toThrow("cannot use manual View order");
  });

  test("validates result envelopes before renderer consumption", () => {
    expect(
      parseDatabaseModuleReadResult({
        ok: true,
        value: {
          version: 1,
          projectId: "project-1",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 2,
          value: { kind: "catalog", databases: [] },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      parseDatabaseApplyResult({
        ok: true,
        value: {
          version: 1,
          operationId: "operation-1",
          projectId: "project-1",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          duplicate: false,
          operationKinds: ["set_value"],
          affectedDatabaseIds: [],
          affectedDataSourceIds: ["source-1"],
          affectedPageIds: ["page-1"],
          affectedViewIds: [],
          committedRevisions: { "value:page-1:property-1": 2 },
          changeLogSeq: 3,
          committedAt: "2026-07-16T00:00:00.000Z",
        },
      }),
    ).toMatchObject({ ok: true });
    expect(() => parseDatabaseModuleReadResult({ ok: true, value: {} })).toThrow(
      "snapshot is invalid",
    );
  });
});
