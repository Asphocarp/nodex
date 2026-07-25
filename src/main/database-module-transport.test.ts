import { Hono } from "hono";
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
  parseDataSourcePropertyId,
} from "../shared/database-identities";
import { registerDatabaseModuleHttpRoutes } from "./database-module-http";
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
      kind: "set_value",
      pageId: "page-1",
      dataSourceId: parseDataSourceId("source-1"),
      propertyId: parseDataSourcePropertyId("status"),
      expectedValueRevision: 1,
      value: "Done",
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
    changeLogSeq: 8,
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

describe("Database Module IPC/HTTP transport", () => {
  test("shares retry identity while replacing transport actor attribution", async () => {
    const received: DatabaseApplyV2[] = [];
    const apply = async (request: DatabaseApplyV2): Promise<DatabaseApplyResultV2> => {
      received.push(request);
      return {
        ok: true,
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
          changeLogSeq: 8,
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

    const app = new Hono();
    registerDatabaseModuleHttpRoutes(app, {
      apply,
      read: async () => readResult(),
    });
    const response = await app.request(
      "/api/projects/project-1/database-module/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyRequest()),
      },
    );
    const http = (await response.json()) as DatabaseApplyResultV2;
    expect(response.status).toBe(200);
    expect(http.ok && http.value.duplicate).toBe(true);
    expect(received[0]?.actor.kind).toBe("electron_renderer");
    expect(received[1]?.actor.kind).toBe("http_loopback");

    const mismatch = await app.request(
      "/api/projects/project-2/database-module/apply",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyRequest()),
      },
    );
    expect(mismatch.status).toBe(400);
    expect(received).toHaveLength(2);
  });

  test("returns the same catalog read over IPC and HTTP", async () => {
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
    const app = new Hono();
    registerDatabaseModuleHttpRoutes(app, {
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
    const response = await app.request(
      "/api/projects/project-1/database-module/read",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readRequest()),
      },
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(ipc)).toBe(JSON.stringify(await response.json()));
  });
});
