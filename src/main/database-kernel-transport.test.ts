import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../shared/database-kernel";
import type {
  DatabaseCatalogSnapshotCommandResult,
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../shared/database-query";
import { registerDatabaseKernelHttpRoutes } from "./database-kernel-http";
import {
  DATABASE_CATALOG_IPC_CHANNEL,
  DATABASE_DESCRIPTOR_IPC_CHANNEL,
  DATABASE_MUTATION_IPC_CHANNEL,
  PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL,
  PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
  DATABASE_VIEW_QUERY_IPC_CHANNEL,
  DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
  registerDatabaseKernelIpcHandlers,
} from "./database-kernel-ipc";

const request = (
  session: string,
  actorKind: string,
): DatabaseMutationRequest => ({
  version: 1,
  operationId: "database-transport-retry",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: session,
  actor: { kind: actorKind },
  operations: [
    {
      kind: "position_card",
      viewId: "view-1",
      cardBlockId: "card-1",
      expectedPositionRevision: 1,
      groupKey: null,
    },
  ],
});

const descriptor =
  (): DatabaseReadCommandResult<GeneralDatabaseDescriptor> => ({
    ok: true,
    value: {
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 7,
      value: null,
    },
  });

const catalog = (): DatabaseCatalogSnapshotCommandResult => ({
  ok: true,
  value: {
    version: 1,
    projectId: "project-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 7,
    value: { databases: [] },
  },
});

const viewQuery = (): DatabaseReadCommandResult<GeneralDatabaseViewQuery> => ({
  ok: true,
  value: {
    version: 1,
    projectId: "project-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 7,
    value: null,
  },
});

const primaryViewSnapshot = (): PrimaryDatabaseViewSnapshotCommandResult => {
  const descriptorResult = descriptor();
  const queryResult = viewQuery();
  if (!descriptorResult.ok || !queryResult.ok) {
    throw new Error("Database transport fixture is invalid");
  }
  return {
    ok: true,
    value: {
      descriptor: descriptorResult.value,
      query: queryResult.value,
    },
  };
};

const viewSnapshot = (): DatabaseViewSnapshotCommandResult =>
  primaryViewSnapshot();

describe("Database IPC/HTTP transport", () => {
  test("rebinds spoofable audit identity and preserves exact retry semantics across IPC and HTTP", async () => {
    const received: DatabaseMutationRequest[] = [];
    const apply = async (
      input: DatabaseMutationRequest,
    ): Promise<DatabaseMutationCommandResult> => {
      received.push(input);
      return {
        ok: true,
        value: {
          version: 1,
          operationId: input.operationId,
          projectId: input.projectId,
          storeEpoch: input.storeEpoch,
          operationKinds: input.operations.map((operation) => operation.kind),
          affectedDatabaseBlockIds: ["database-1"],
          duplicate: received.length > 1,
          payload: { operationResults: [] },
          changeLogSeq: 7,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      };
    };

    const handlers = new Map<
      string,
      (event: unknown, projectId: string, value?: unknown) => Promise<unknown>
    >();
    registerDatabaseKernelIpcHandlers({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      resolveTrustedIdentity: (event) =>
        event === "trusted"
          ? {
              clientSessionId: "trusted-electron-window",
              actor: { kind: "electron_renderer", clientId: "window-1" },
            }
          : null,
      applyMutation: apply,
      readCatalog: async () => catalog(),
      readDescriptor: async () => descriptor(),
      readPrimaryDescriptor: async () => descriptor(),
      readPrimaryViewSnapshot: async () => primaryViewSnapshot(),
      queryView: async () => viewQuery(),
    });

    const ipc = (await handlers.get(DATABASE_MUTATION_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      request("electron-window-1", "electron_actor"),
    )) as DatabaseMutationCommandResult;
    expect(ipc.ok && ipc.value.duplicate).toBe(false);
    const untrusted = (await handlers.get(DATABASE_MUTATION_IPC_CHANNEL)?.(
      "untrusted-subframe",
      "project-1",
      request("spoofed-session", "spoofed-actor"),
    )) as DatabaseMutationCommandResult;
    expect(
      !untrusted.ok &&
        untrusted.error.code === "invalid_database_mutation_request",
    ).toBe(true);
    expect(received.length).toBe(1);

    const app = new Hono();
    registerDatabaseKernelHttpRoutes(app, {
      applyMutation: apply,
      readCatalog: async () => catalog(),
      readDescriptor: async () => descriptor(),
      readPrimaryDescriptor: async () => descriptor(),
      readPrimaryViewSnapshot: async () => primaryViewSnapshot(),
      queryView: async () => viewQuery(),
    });
    const response = await app.request(
      "/api/projects/project-1/database-mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request("cli-session-2", "nodex_cli")),
      },
    );
    const http = (await response.json()) as DatabaseMutationCommandResult;
    expect(response.status).toBe(200);
    expect(http.ok && http.value.duplicate).toBe(true);
    expect(received[0]?.clientSessionId).toBe("trusted-electron-window");
    expect(received[1]?.clientSessionId).toBe("http-loopback");
    expect(received[0]?.actor.kind).toBe("electron_renderer");
    expect(received[1]?.actor.kind).toBe("http_loopback");

    const mismatch = await app.request(
      "/api/projects/other-project/database-mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request("cli-session-3", "nodex_cli")),
      },
    );
    expect(mismatch.status).toBe(400);
    expect(received.length).toBe(2);
  });

  test("returns the same JSON-only descriptor and View snapshots over IPC and HTTP", async () => {
    const snapshotReads: string[] = [];
    const handlers = new Map<
      string,
      (event: unknown, projectId: string, value?: unknown) => Promise<unknown>
    >();
    registerDatabaseKernelIpcHandlers({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      resolveTrustedIdentity: () => ({
        clientSessionId: "trusted-electron-window",
        actor: { kind: "electron_renderer" },
      }),
      applyMutation: async () => {
        throw new Error("not used");
      },
      readCatalog: async () => catalog(),
      readDescriptor: async () => descriptor(),
      readPrimaryDescriptor: async () => descriptor(),
      readPrimaryViewSnapshot: async () => primaryViewSnapshot(),
      readViewSnapshot: async (projectId, viewId) => {
        snapshotReads.push(`ipc:${projectId}:${viewId}`);
        return viewSnapshot();
      },
      queryView: async () => viewQuery(),
    });
    const app = new Hono();
    registerDatabaseKernelHttpRoutes(app, {
      applyMutation: async () => {
        throw new Error("not used");
      },
      readCatalog: async () => catalog(),
      readDescriptor: async () => descriptor(),
      readPrimaryDescriptor: async () => descriptor(),
      readPrimaryViewSnapshot: async () => primaryViewSnapshot(),
      readViewSnapshot: async (projectId, viewId) => {
        snapshotReads.push(`http:${projectId}:${viewId}`);
        return viewSnapshot();
      },
      queryView: async () => viewQuery(),
    });

    const ipcDescriptor = await handlers.get(DATABASE_DESCRIPTOR_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      "database-1",
    );
    const httpDescriptor = await (
      await app.request("/api/projects/project-1/databases/database-1")
    ).json();
    expect(JSON.stringify(ipcDescriptor)).toBe(JSON.stringify(httpDescriptor));

    const ipcCatalog = await handlers.get(DATABASE_CATALOG_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
    );
    const httpCatalog = await (
      await app.request("/api/projects/project-1/databases")
    ).json();
    expect(JSON.stringify(ipcCatalog)).toBe(JSON.stringify(httpCatalog));

    const ipcPrimary = await handlers.get(
      PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL,
    )?.("trusted", "project-1");
    const httpPrimary = await (
      await app.request("/api/projects/project-1/databases/primary")
    ).json();
    expect(JSON.stringify(ipcPrimary)).toBe(JSON.stringify(httpPrimary));

    const ipcPrimaryViewSnapshot = await handlers.get(
      PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
    )?.("trusted", "project-1");
    const httpPrimaryViewSnapshot = await (
      await app.request(
        "/api/projects/project-1/database-views/primary/snapshot",
      )
    ).json();
    expect(JSON.stringify(ipcPrimaryViewSnapshot)).toBe(
      JSON.stringify(httpPrimaryViewSnapshot),
    );

    const ipcViewSnapshot = await handlers.get(
      DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
    )?.("trusted", "project-1", "view-secondary");
    const httpViewSnapshot = await (
      await app.request(
        "/api/projects/project-1/database-views/view-secondary/snapshot",
      )
    ).json();
    expect(JSON.stringify(ipcViewSnapshot)).toBe(
      JSON.stringify(httpViewSnapshot),
    );
    expect(snapshotReads.join(",")).toBe(
      "ipc:project-1:view-secondary,http:project-1:view-secondary",
    );

    const ipcQuery = await handlers.get(DATABASE_VIEW_QUERY_IPC_CHANNEL)?.(
      "trusted",
      "project-1",
      "view-1",
    );
    const httpQuery = await (
      await app.request("/api/projects/project-1/database-views/view-1/query")
    ).json();
    expect(JSON.stringify(ipcQuery)).toBe(JSON.stringify(httpQuery));
  });
});
