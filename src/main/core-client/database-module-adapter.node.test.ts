import { describe, expect, test } from "vitest";

import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import { parseDataSourceId } from "../../shared/database-identities";
import { createCoreDatabaseModuleAdapter } from "./database-module-adapter";
import { createDesktopDatabaseModuleBridge } from "./desktop-database-module-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { FakeCoreClient } from "./testing/fake-core-client";

const identity = {
  projectId: "project:test",
  libraryId: "library:test",
  storeEpoch: "epoch:test",
} as const;

const emptyCatalogSnapshot = () => ({
  version: 1 as const,
  store_epoch: identity.storeEpoch,
  event_head: 17,
  value: { kind: "catalog" as const, databases: [] },
});

describe("Core Database Module Adapter", () => {
  test("maps the Project-bound read and validates the shared v2 snapshot", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: { target: { kind: "project_default" }, mode: "catalog" },
    })).resolves.toEqual({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: identity.projectId,
        libraryId: identity.libraryId,
        storeEpoch: identity.storeEpoch,
        changeLogSeq: 17,
        value: { kind: "catalog", databases: [] },
      },
    });
    expect(client.databaseReads).toEqual([{
      target: { kind: "project_default" },
      mode: "catalog",
      filter: undefined,
      sort: null,
    }]);
  });

  test("preserves filter JSON while translating only typed target fields", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });
    const filter = {
      kind: "clause" as const,
      propertyId: "p_status",
      operator: "equals" as const,
      value: "done",
    };
    const sort = [{
      field: { kind: "property" as const, propertyId: "p_status" },
      direction: "asc" as const,
      nulls: "last" as const,
    }];

    await adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: parseDataSourceId("source:test"),
        },
        mode: "query",
        filter,
        sort,
      },
    });

    expect(client.databaseReads).toEqual([{
      target: { kind: "data_source", data_source_id: "source:test" },
      mode: "query",
      filter,
      sort,
    }]);
  });

  test("selects one cached Core client for each Project", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    const requestedProjects: string[] = [];
    const runtime = {
      backend: "rust",
      rootClient: {
        handshake: {
          library_id: identity.libraryId,
          profile_id: "profile:test",
          store_epoch: identity.storeEpoch,
        },
      },
      clientForProject: (projectId: string) => {
        requestedProjects.push(projectId);
        return client;
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
      typescript: {
        read: async () => {
          throw new Error("TypeScript Database read must not run");
        },
      },
    });
    const request = {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: { target: { kind: "project_default" as const }, mode: "catalog" as const },
    };

    await expect(bridge.read(request)).resolves.toMatchObject({ ok: true });
    await expect(bridge.read(request)).resolves.toMatchObject({ ok: true });
    expect(requestedProjects).toEqual([identity.projectId]);
  });
});
