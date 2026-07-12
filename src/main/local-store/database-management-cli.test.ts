import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

interface CapturedRequest {
  readonly method: string;
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

const timestamp = "2026-07-12T08:00:00.000Z";
const viewConfig = {
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
  group: null,
  display: { propertyIds: [], showTitle: true },
};

const database = (id: string, viewId: string) => ({
  database: {
    blockId: id,
    projectId: "default",
    name: id,
    isPrimary: id === "database-a",
    schemaKey: "nodex.database",
    schemaRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  properties: [],
  views: [
    {
      id: viewId,
      databaseBlockId: id,
      projectId: "default",
      name: "All",
      kind: "list",
      config: viewConfig,
      isPrimary: true,
      revision: 3,
      rankKey: "1",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
});

const card = (blockId: string) => ({
  blockId,
  projectId: "default",
  lifecycle: "active",
  location: { kind: "space", rankKey: "1" },
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
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("Database management CLI", () => {
  test("compiles membership and selected-View writes from public authority snapshots", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-database-management-cli-"),
    );
    const databaseA = database("database-a", "view-a");
    const databaseB = database("database-b", "view-b");
    const management = {
      version: 1,
      projectId: "default",
      storeEpoch: "epoch-1",
      changeLogSeq: 9,
      value: {
        catalog: { databases: [databaseA, databaseB] },
        cards: [
          { card: card("card-new"), membership: null, positions: [] },
          {
            card: {
              ...card("card-owned"),
              location: {
                kind: "database",
                databaseBlockId: "database-a",
              },
            },
            membership: {
              id: "membership-owned",
              databaseBlockId: "database-a",
              cardBlockId: "card-owned",
              revision: 4,
              createdAt: timestamp,
            },
            positions: [],
          },
        ],
      },
    };
    const requests: CapturedRequest[] = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const body = chunks.length > 0
          ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Readonly<Record<string, unknown>>)
          : {};
        requests.push({
          method: request.method ?? "GET",
          pathname: url.pathname,
          body,
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        if (url.pathname.endsWith("/databases/management")) {
          response.end(JSON.stringify({ ok: true, value: management }));
          return;
        }
        if (url.pathname.endsWith("/database-views/view-b/snapshot")) {
          response.end(JSON.stringify({
            ok: true,
            value: {
              descriptor: { ...management, value: databaseB },
              query: {
                ...management,
                value: {
                  database: databaseB.database,
                  view: databaseB.views[0],
                  properties: [],
                  rows: [],
                },
              },
            },
          }));
          return;
        }
        const operationId = body.operationId;
        response.end(JSON.stringify({
          ok: true,
          value: {
            version: 1,
            operationId,
            projectId: "default",
            storeEpoch: "epoch-1",
            operationKinds: [],
            affectedDatabaseBlockIds: [],
            duplicate: false,
            payload: {},
            changeLogSeq: 10,
            committedAt: timestamp,
          },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server failed");
      const base = ["--url", `http://127.0.0.1:${address.port}`, "--project", "default"];
      const add = await runCli([
        "database",
        "membership",
        "card-new",
        "database-b",
        "--mutation-id",
        "membership-add",
        ...base,
      ], homeDir);
      expect(add.exitCode).toBe(0);
      const addIntent = requests.find(
        (entry) => entry.body.operationId === "membership-add",
      );
      expect(addIntent?.pathname).toBe(
        "/api/projects/default/block-transfers",
      );
      expect(addIntent?.body.source).toEqual({ kind: "space" });
      expect(
        (addIntent?.body.target as Readonly<Record<string, unknown>>)?.viewId,
      ).toBe("view-b");

      const transfer = await runCli(
        [
          "database",
          "membership",
          "card-owned",
          "database-b",
          "--mutation-id",
          "membership-transfer",
          ...base,
        ],
        homeDir,
      );
      expect(transfer.exitCode).toBe(0);
      const transferIntent = requests.find(
        (entry) => entry.body.operationId === "membership-transfer",
      );
      expect(transferIntent?.body.source).toEqual({
        kind: "database",
        databaseBlockId: "database-a",
      });
      expect(transferIntent?.body.target).toMatchObject({
        kind: "database",
        databaseBlockId: "database-b",
      });

      const remove = await runCli([
        "database",
        "membership",
        "card-owned",
        "none",
        "--mutation-id",
        "membership-remove",
        ...base,
      ], homeDir);
      expect(remove.exitCode).toBe(0);
      const removeIntent = requests.find(
        (entry) => entry.body.operationId === "membership-remove",
      );
      expect(removeIntent?.body.source).toEqual({
        kind: "database",
        databaseBlockId: "database-a",
      });
      expect(removeIntent?.body.target).toEqual({ kind: "space" });

      const removeMissing = await runCli([
        "database",
        "membership",
        "card-new",
        "none",
        "--mutation-id",
        "membership-remove-missing",
        ...base,
      ], homeDir);
      expect(removeMissing.exitCode).toBe(1);
      expect(removeMissing.stderr).toContain(
        "Card card-new has no owning Database membership",
      );

      const update = await runCli([
        "database",
        "view-update",
        "view-b",
        JSON.stringify({ name: "Research queue", kind: "kanban" }),
        "--mutation-id",
        "view-update",
        ...base,
      ], homeDir);
      expect(update.exitCode).toBe(0);
      const viewOperation = requests.find(
        (entry) => entry.body.operationId === "view-update",
      )?.body.operations as readonly Record<string, unknown>[] | undefined;
      expect(viewOperation?.[0]?.kind).toBe("put_view");
      expect(viewOperation?.[0]?.viewId).toBe("view-b");
      expect(viewOperation?.[0]?.expectedRevision).toBe(3);
      expect(viewOperation?.[0]?.name).toBe("Research queue");
      expect(viewOperation?.[0]?.viewKind).toBe("kanban");
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
