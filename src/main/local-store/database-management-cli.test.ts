import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

interface CapturedRequest {
  readonly pathname: string;
  readonly body: Readonly<Record<string, unknown>>;
}

const runCli = (
  args: readonly string[],
  homeDir: string,
): Promise<{ readonly exitCode: number; readonly stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "bin", "nodex.mjs"), ...args],
      {
        env: { ...process.env, HOME: homeDir },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stderr: stderr.trim() });
    });
  });

const timestamp = "2026-07-16T08:00:00.000Z";
const viewConfig = {
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
  group: null,
  display: { propertyIds: [], showTitle: true },
};

const descriptor = {
  database: {
    databaseId: "database-b",
    libraryId: "library-default",
    name: "Research",
    lifecycle: "active",
    defaultViewId: "view-b",
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  dataSources: [{
    dataSourceId: "source-b",
    libraryId: "library-default",
    homeDatabaseId: "database-b",
    name: "Pages",
    schemaKey: "nodex.page",
    schemaRevision: 1,
    lifecycle: "active",
    rankKey: "a",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  views: [{
    viewId: "view-b",
    databaseId: "database-b",
    dataSourceId: "source-b",
    name: "All",
    kind: "list",
    config: viewConfig,
    isDefault: true,
    revision: 3,
    rankKey: "a",
    lifecycle: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
};

const readSnapshot = (value: unknown) => ({
  ok: true,
  value: {
    version: 1,
    projectId: "default",
    libraryId: "library-default",
    storeEpoch: "epoch-1",
    changeLogSeq: 9,
    value,
  },
});

const pageDetail = (pageId: string, member: boolean) => ({
  ok: true,
  value: {
    version: 1,
    projectId: "default",
    libraryId: "library-default",
    storeEpoch: "epoch-1",
    changeLogSeq: 9,
    page: {
      pageId,
      parentRevision: 2,
    },
    dataSourceContext: member
      ? {
          kind: "member",
          membership: {
            membershipId: "membership-a",
            dataSourceId: "source-a",
            revision: 4,
          },
        }
      : { kind: "standalone" },
  },
});

describe("Database Module CLI", () => {
  test("compiles Page membership and View writes from canonical snapshots", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-database-module-cli-"),
    );
    const requests: CapturedRequest[] = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const pathname = new URL(
          request.url ?? "/",
          "http://127.0.0.1",
        ).pathname;
        const body = chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Readonly<Record<string, unknown>>
          : {};
        requests.push({ pathname, body });
        response.writeHead(200, { "Content-Type": "application/json" });

        if (pathname.endsWith("/pages/page-new")) {
          response.end(JSON.stringify(pageDetail("page-new", false)));
          return;
        }
        if (pathname.endsWith("/pages/page-owned")) {
          response.end(JSON.stringify(pageDetail("page-owned", true)));
          return;
        }
        if (pathname.endsWith("/database-module/read")) {
          const read = body.read as {
            readonly target?: { readonly kind?: string };
          };
          response.end(JSON.stringify(readSnapshot(
            read.target?.kind === "view"
              ? { kind: "view", value: descriptor.views[0] }
              : { kind: "database", value: descriptor },
          )));
          return;
        }
        response.end(JSON.stringify({
          ok: true,
          value: {
            version: 1,
            operationId: body.operationId,
            projectId: "default",
            libraryId: "library-default",
            storeEpoch: "epoch-1",
            duplicate: false,
            operationKinds: [],
            affectedDatabaseIds: ["database-b"],
            affectedDataSourceIds: ["source-b"],
            affectedPageIds: [],
            affectedViewIds: [],
            committedRevisions: {},
            changeLogSeq: 10,
            committedAt: timestamp,
          },
        }));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server failed");
      }
      const base = [
        "--url",
        `http://127.0.0.1:${address.port}`,
        "--project",
        "default",
      ];

      const add = await runCli([
        "database",
        "membership",
        "page-new",
        "database-b",
        "--mutation-id",
        "membership-add",
        ...base,
      ], homeDir);
      expect(add.exitCode, add.stderr).toBe(0);
      const addOperations = requests.find(
        (entry) => entry.body.operationId === "membership-add",
      )?.body.operations as readonly Record<string, unknown>[] | undefined;
      expect(addOperations?.[0]).toMatchObject({
        kind: "transfer_page",
        pageId: "page-new",
        expectedParentRevision: 2,
        expectedActiveMembershipRevision: 0,
      });
      expect(addOperations?.[1]).toMatchObject({
        kind: "position_page",
        viewId: "view-b",
        pageId: "page-new",
      });

      const remove = await runCli([
        "database",
        "membership",
        "page-owned",
        "none",
        "--mutation-id",
        "membership-remove",
        ...base,
      ], homeDir);
      expect(remove.exitCode, remove.stderr).toBe(0);
      const removeOperations = requests.find(
        (entry) => entry.body.operationId === "membership-remove",
      )?.body.operations as readonly Record<string, unknown>[] | undefined;
      expect(removeOperations?.[0]).toMatchObject({
        kind: "transfer_page",
        expectedActiveMembershipRevision: 4,
        target: { kind: "library", libraryId: "library-default" },
      });

      const update = await runCli([
        "database",
        "view-update",
        "view-b",
        JSON.stringify({ name: "Research queue", kind: "kanban" }),
        "--mutation-id",
        "view-update",
        ...base,
      ], homeDir);
      expect(update.exitCode, update.stderr).toBe(0);
      const viewOperation = requests.find(
        (entry) => entry.body.operationId === "view-update",
      )?.body.operations as readonly Record<string, unknown>[] | undefined;
      expect(viewOperation?.[0]).toMatchObject({
        kind: "put_view",
        databaseId: "database-b",
        dataSourceId: "source-b",
        viewId: "view-b",
        expectedRevision: 3,
        name: "Research queue",
        viewKind: "kanban",
      });
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
