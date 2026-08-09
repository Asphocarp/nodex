import { describe, expect, test } from "vitest";
import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadResultV2,
} from "../shared/database-module-v2";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../shared/database-identities";
import {
  DATABASE_MODULE_APPLY_IPC_CHANNEL,
  DATABASE_MODULE_READ_IPC_CHANNEL,
  registerDatabaseModuleIpcHandlers,
} from "./database-module-ipc";

const applyRequest = (): DatabaseApplyV2 => ({
  version: DATABASE_MODULE_V2_CONTRACT_VERSION,
  operationId: "database-module-retry-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  actor: { kind: "spoofed" },
  operations: [
    {
      kind: "edit_property_values",
      edits: [{
        pageId: "page-1",
        dataSourceId: parseDataSourceId("source-1"),
        propertyId: parseDataSourcePropertyId("status"),
        edit: {
          kind: "replace",
          expectedValueRevision: 1,
          value: {
            kind: "select",
            optionId: parseDataSourceOptionId({
              propertyId: parseDataSourcePropertyId("status"),
              value: "ship",
            }),
          },
        },
      }],
    },
  ],
});

const readRequest = () => ({
  version: DATABASE_MODULE_V2_CONTRACT_VERSION,
  projectId: "project-1",
  read: {
    target: { kind: "project_default" as const },
    mode: "database" as const,
  },
});

const readResult = (): DatabaseModuleReadResultV2 => ({
  ok: true,
  value: {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId: "project-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    commitSeq: 8,
    value: {
      kind: "database",
      value: {
        database: {
          databaseId: parseDatabaseId("database-1"),
          libraryId: "library-1",
          name: "Tasks",
          lifecycle: "active",
          defaultViewId: null,
          accessRevision: 1,
          metadataRevision: 1,
          createdAt: "2026-07-16T00:00:00.000Z",
          updatedAt: "2026-07-16T00:00:00.000Z",
        },
        dataSources: [],
        views: [],
      },
    },
  },
});

describe("Database Module IPC", () => {
  test("preserves retry identity while binding trusted actor attribution", async () => {
    const received: DatabaseApplyV2[] = [];
    const apply = async (request: DatabaseApplyV2): Promise<DatabaseApplyResultV2> => {
      received.push(request);
      return {
        ok: true,
        localCommit: {
          status: "no_op",
          observed: { store_epoch: request.storeEpoch, commit_head: 8 },
        },
        value: {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          operationId: request.operationId,
          projectId: request.projectId,
          libraryId: "library-1",
          storeEpoch: request.storeEpoch,
          duplicate: received.length > 1,
          operationKinds: request.operations.map((operation) => operation.kind),
          affectedDatabaseIds: [],
          affectedDataSourceIds: [parseDataSourceId("source-1")],
          affectedPageIds: ["page-1"],
          affectedViewIds: [],
          committedRevisions: { "value:page-1:status": 2 },
          commitSeq: 8,
          committedAt: "2026-07-16T00:00:00.000Z",
        },
      };
    };
    const handlers = new Map<
      string,
      (event: unknown, projectId: string, request: unknown) => Promise<unknown>
    >();
    registerDatabaseModuleIpcHandlers({
      registerHandle: (channel, handler) => handlers.set(channel, handler),
      resolveTrustedIdentity: (event) =>
        event === "trusted"
          ? { actor: { kind: "electron_renderer", clientId: "window-1" } }
          : null,
      apply,
      read: async () => readResult(),
    });

    const ipc = (await handlers.get(DATABASE_MODULE_APPLY_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      applyRequest(),
    )) as DatabaseApplyResultV2;
    expect(ipc.ok && ipc.value.duplicate).toBe(false);
    const untrusted = (await handlers.get(DATABASE_MODULE_APPLY_IPC_CHANNEL)?.(
      "subframe",
      "project-1",
      applyRequest(),
    )) as DatabaseApplyResultV2;
    expect(!untrusted.ok && untrusted.error.code).toBe("invalid_request");

    expect(received[0]?.actor).toEqual({
      kind: "electron_renderer",
      clientId: "window-1",
    });
    expect(received).toHaveLength(1);
  });

  test("returns the catalog read over IPC", async () => {
    const handlers = new Map<
      string,
      (event: unknown, projectId: string, request: unknown) => Promise<unknown>
    >();
    registerDatabaseModuleIpcHandlers({
      registerHandle: (channel, handler) => handlers.set(channel, handler),
      resolveTrustedIdentity: () => ({ actor: { kind: "test" } }),
      apply: async () => {
        throw new Error("not used");
      },
      read: async () => readResult(),
    });
    const ipc = await handlers.get(DATABASE_MODULE_READ_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      readRequest(),
    );
    expect(ipc).toEqual(readResult());
  });
});
