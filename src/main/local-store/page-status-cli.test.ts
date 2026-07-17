import { describe, expect, test } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const lifecyclePreflight = (
  page: Readonly<Record<string, unknown>> | null = null,
): Readonly<Record<string, unknown>> => ({
  ok: true,
  value: {
    version: 2,
    projectId: "default",
    libraryId: "library-default",
    storeEpoch: "epoch-1",
    changeLogSeq: 3,
    value: {
      version: 2,
      reservedBlockType: null,
      page,
      defaultView: {
        dataSource: { dataSourceId: "data-source-primary" },
      },
      tagsProperty: {
        propertyId: "tags",
        dataSourceId: "data-source-primary",
        valueType: "multi_select",
        lifecycle: "active",
        revision: 7,
        config: { options: [{ id: "o_AAAAAAAA", name: "Release" }] },
      },
    },
  },
});

function runCli(
  args: string[],
  homeDir: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliPath = path.join(process.cwd(), "bin", "nodex.mjs");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        HOME: homeDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

describe("Page status CLI arguments", () => {
  test("rejects retired Agent flags and omits retired fields from list output", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-retired-agent-cli-home-"),
    );
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (
        req.method === "GET" &&
        url.pathname === "/api/projects/default/column"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "plan",
          name: "Plan",
          cards: [{
            id: "page-legacy-agent-fields",
            status: "plan",
            archived: false,
            title: "Current Page output",
            description: "Current description",
            priority: "p2-medium",
            estimate: "m",
            tags: ["current"],
            dueDate: "2026-07-20",
            assignee: "owner",
            agentBlocked: true,
            agentStatus: "legacy status",
            created: "2026-07-15T00:00:00.000Z",
            order: 0,
          }],
        }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to start test server");
      }
      const baseArgs = [
        "plan",
        "--project",
        "default",
        "--url",
        `http://127.0.0.1:${address.port}`,
      ];
      const listed = await runCli(["ls", ...baseArgs], homeDir);
      expect(listed.exitCode).toBe(0);
      const listedPage = JSON.parse(listed.stdout) as Record<string, unknown>;
      expect(listedPage.title).toBe("Current Page output");
      expect("blocked" in listedPage).toBe(false);
      expect("agentBlocked" in listedPage).toBe(false);
      expect("agentStatus" in listedPage).toBe(false);

      const full = await runCli(["ls", ...baseArgs, "--full"], homeDir);
      expect(full.exitCode).toBe(0);
      const fullPage = JSON.parse(full.stdout) as Record<string, unknown>;
      expect(fullPage.description).toBe("Current description");
      expect("blocked" in fullPage).toBe(false);
      expect("agentBlocked" in fullPage).toBe(false);
      expect("agentStatus" in fullPage).toBe(false);

      const blocked = await runCli(["ls", "--blocked"], homeDir);
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr).toContain("Unknown option: --blocked");

      const agentStatus = await runCli(
        ["update", "page-1", "--agent-status", "running"],
        homeDir,
      );
      expect(agentStatus.exitCode).toBe(1);
      expect(agentStatus.stderr).toContain("Unknown option: --agent-status");
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("accepts canonical statuses and ergonomic aliases, and rejects legacy shorthands", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-status-cli-home-"));
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    let createdPageId = "";
    let createdStatus = "triage";

    const server = http.createServer((req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];

      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : null;
        requests.push({ method, path: url.pathname + url.search, body });

        if (method === "GET" && url.pathname === "/api/projects/default/column") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: url.searchParams.get("id"), name: "Build", cards: [] }));
          return;
        }

        if (
          method === "GET" &&
          url.pathname === "/api/projects/default/page-lifecycle-preflight"
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(lifecyclePreflight()));
          return;
        }

        if (
          method === "POST" &&
          url.pathname === "/api/projects/default/page-lifecycle-mutations"
        ) {
          const operation = body?.operation as Record<string, unknown> | undefined;
          createdPageId = String(operation?.pageId ?? "");
          createdStatus = String(operation?.status ?? "triage");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 2,
              operationId: body?.operationId,
              projectId: "default",
              storeEpoch: "epoch-1",
              operationKind: "create_page",
              pageId: createdPageId,
              duplicate: false,
              lifecycle: "active",
            },
          }));
          return;
        }

        if (
          method === "GET" &&
          url.pathname === "/api/projects/default/database-row" &&
          url.searchParams.get("pageId") === createdPageId
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: createdPageId,
            status: createdStatus,
            archived: false,
            title: "Ship it",
            description: "",
            priority: "p2-medium",
            tags: [],
            created: "2026-03-12T00:00:00.000Z",
            order: 0,
          }));
          return;
        }

        if (method === "GET" && url.pathname === "/api/projects/default/database-row") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "page-1",
            status: "ship",
            archived: false,
            title: "Ship it",
            description: "",
            priority: "p2-medium",
            tags: [],
            created: "2026-03-12T00:00:00.000Z",
            order: 0,
          }));
          return;
        }

        if (
          method === "POST" &&
          url.pathname === "/api/projects/default/database-module/read"
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 2,
              projectId: "default",
              libraryId: "library-default",
              storeEpoch: "epoch-1",
              changeLogSeq: 7,
              value: {
                kind: "query",
                value: {
                  database: { databaseId: "database-primary" },
                  dataSource: { dataSourceId: "data-source-primary" },
                  view: {
                    viewId: "view-primary",
                    kind: "kanban",
                    config: { sort: [{ field: { kind: "manual" } }] },
                  },
                  properties: [
                  {
                    propertyId: "status",
                    lifecycle: "active",
                  },
                  ],
                  rows: [
                  {
                    page: { pageId: "page-1" },
                    values: {
                      status: {
                        value: "build",
                        revision: 3,
                      },
                    },
                    effectiveGroupKey: "build",
                    position: { revision: 5 },
                  },
                  ],
                },
              },
            },
          }));
          return;
        }

        if (
          method === "POST" &&
          url.pathname === "/api/projects/default/database-module/apply"
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              operationId: body?.operationId,
              duplicate: false,
            },
          }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to start test server");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const lsResult = await runCli(["ls", "build", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(lsResult.exitCode).toBe(0);

      const addResult = await runCli(["add", "review", "Ship it", "--tags", "Release, 新标签", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(addResult.exitCode).toBe(0);

      const moveResult = await runCli(["mv", "page-1", "build", "ship", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(moveResult.exitCode).toBe(0);

      const legacyStatus = await runCli(["ls", "in-progress", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(legacyStatus.exitCode).toBe(1);
      expect(legacyStatus.stderr.includes("Unknown status")).toBe(true);

      const legacyNumeric = await runCli(["ls", "5", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(legacyNumeric.exitCode).toBe(1);
      expect(legacyNumeric.stderr.includes("Unknown status")).toBe(true);

      const legacyReady = await runCli(["ls", "5-ready", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(legacyReady.exitCode).toBe(1);
      expect(legacyReady.stderr.includes("Unknown status")).toBe(true);

      const listRequest = requests.find((request) => request.method === "GET");
      expect(listRequest?.path).toBe("/api/projects/default/column?id=build");

      const createRequest = requests.find(
        (request) =>
          request.method === "POST" &&
          (request.body?.operation as Record<string, unknown> | undefined)?.kind ===
            "create_page",
      );
      expect(
        (createRequest?.body?.operation as Record<string, unknown> | undefined)
          ?.status,
      ).toBe("review");
      expect(createRequest?.body?.version).toBe(2);
      expect(
        (createRequest?.body?.operation as Record<string, unknown> | undefined)
          ?.dataSourceId,
      ).toBe("data-source-primary");
      expect(
        (createRequest?.body?.operation as Record<string, unknown> | undefined)
          ?.tagOptionIds,
      ).toEqual(expect.arrayContaining(["o_AAAAAAAA"]));
      const createdOptions = (
        createRequest?.body?.operation as Record<string, unknown> | undefined
      )?.newTagOptions as
        | ReadonlyArray<Readonly<Record<string, unknown>>>
        | undefined;
      expect(createdOptions).toHaveLength(1);
      expect(createdOptions?.[0]?.name).toBe("新标签");
      expect(createdOptions?.[0]?.optionId).toMatch(/^o_[A-Za-z0-9_-]{8}$/u);
      expect(
        (createRequest?.body?.operation as Record<string, unknown> | undefined)
          ?.expectedTagsPropertyRevision,
      ).toBe(7);

      const moveRequest = requests.find(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/projects/default/database-module/apply",
      );
      const moveOperations = moveRequest?.body?.operations as
        | ReadonlyArray<Readonly<Record<string, unknown>>>
        | undefined;
      expect(moveOperations?.length).toBe(2);
      expect(moveOperations?.[0]?.kind).toBe("set_value");
      expect(moveOperations?.[0]?.pageId).toBe("page-1");
      expect(moveOperations?.[0]?.dataSourceId).toBe("data-source-primary");
      expect(moveOperations?.[0]?.propertyId).toBe("status");
      expect(moveOperations?.[0]?.expectedValueRevision).toBe(3);
      expect(moveOperations?.[0]?.value).toBe("ship");
      expect(moveOperations?.[1]?.kind).toBe("position_page");
      expect(moveOperations?.[1]?.viewId).toBe("view-primary");
      expect(moveOperations?.[1]?.expectedPositionRevision).toBe(5);
      expect(moveOperations?.[1]?.groupKey).toBe("ship");
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("add and rm use lifecycle preflight, exact retry, and canonical reads", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-lifecycle-cli-home-"),
    );
    const mutations: Record<string, unknown>[] = [];
    let createdPageId = "";
    let deleted = false;
    let createAttempts = 0;

    const server = http.createServer((req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const body = rawBody
          ? (JSON.parse(rawBody) as Record<string, unknown>)
          : null;

        if (
          method === "GET" &&
          url.pathname === "/api/projects/default/page-lifecycle-preflight"
        ) {
          const pageId = url.searchParams.get("pageId") ?? "";
          const existingCard =
            pageId === "page-existing" ||
            (createdPageId.length > 0 && pageId === createdPageId)
            ? {
                pageId,
                lifecycle: "active",
                parent: { kind: "library", libraryId: "library-1" },
                libraryRankKey: "m",
                metadataRevision: 4,
                parentRevision: 6,
              }
            : null;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(lifecyclePreflight(existingCard)));
          return;
        }

        if (
          method === "POST" &&
          url.pathname === "/api/projects/default/page-lifecycle-mutations" &&
          body
        ) {
          mutations.push(body);
          const operation = body.operation as Record<string, unknown>;
          if (operation.kind === "create_page") {
            const requestedCardId = String(operation.pageId);
            if (
              createdPageId.length > 0 &&
              requestedCardId !== createdPageId &&
              body.operationId === "cli-create-stable"
            ) {
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                ok: false,
                error: {
                  code: "operation_id_collision",
                  message: "Operation identity names another Page create",
                  retryable: false,
                  operationId: body.operationId,
                  pageId: requestedCardId,
                },
              }));
              return;
            }
            createAttempts += 1;
            createdPageId = requestedCardId;
            if (createAttempts === 1) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                ok: false,
                error: {
                  code: "unknown",
                  message: "response outcome unavailable",
                  retryable: true,
                  operationId: body.operationId,
                  pageId: createdPageId,
                },
              }));
              return;
            }
          } else if (operation.kind === "delete_page") {
            deleted = true;
          }
          const lifecycle = operation.kind === "delete_page" ? "deleted" : "active";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 2,
              operationId: body.operationId,
              projectId: "default",
              storeEpoch: "epoch-1",
              operationKind: operation.kind,
              pageId: operation.pageId,
              duplicate: createAttempts > 1,
              lifecycle,
            },
          }));
          return;
        }

        if (method === "GET" && url.pathname === "/api/projects/default/database-row") {
          const pageId = url.searchParams.get("pageId") ?? "";
          if (pageId === "page-existing" && deleted) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }
          const isCreated = pageId === createdPageId;
          if (isCreated || pageId === "page-existing") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              id: pageId,
              status: "triage",
              archived: false,
              title: isCreated ? "Exact retry" : "Existing",
              description: "",
              tags: [],
              created: "2026-07-11T00:00:00.000Z",
              order: 0,
            }));
            return;
          }
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to start test server");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const unsafeRetryIdentity = await runCli(
        [
          "add",
          "triage",
          "Unsafe retry",
          "--mutation-id",
          "operation-without-page-id",
          "--project",
          "default",
          "--url",
          baseUrl,
        ],
        homeDir,
      );
      expect(unsafeRetryIdentity.exitCode).toBe(1);
      expect(unsafeRetryIdentity.stderr.includes("requires --page-id")).toBe(true);

      const addArgs = [
        "add",
        "triage",
        "Exact retry",
        "--page-id",
        "page-create-stable",
        "--mutation-id",
        "cli-create-stable",
        "--project",
        "default",
        "--url",
        baseUrl,
        "--json",
      ];
      const add = await runCli(addArgs, homeDir);
      expect(add.exitCode).toBe(0);
      const addAfterProcessRestart = await runCli(addArgs, homeDir);
      expect(addAfterProcessRestart.exitCode).toBe(0);
      const createMutationsBeforeCollision = mutations.filter(
        (mutation) =>
          (mutation.operation as Record<string, unknown>).kind === "create_page",
      );
      expect(createMutationsBeforeCollision.length).toBe(3);
      expect(JSON.stringify(createMutationsBeforeCollision[0])).toBe(
        JSON.stringify(createMutationsBeforeCollision[1]),
      );
      expect(JSON.stringify(createMutationsBeforeCollision[1])).toBe(
        JSON.stringify(createMutationsBeforeCollision[2]),
      );
      expect(createMutationsBeforeCollision[0]?.operationId).toBe(
        "cli-create-stable",
      );
      expect(
        (createMutationsBeforeCollision[0]?.operation as Record<string, unknown>)
          .pageId,
      ).toBe("page-create-stable");
      expect(createMutationsBeforeCollision[0]?.version).toBe(2);
      expect(
        (createMutationsBeforeCollision[0]?.operation as Record<string, unknown>)
          .tagOptionIds,
      ).toEqual([]);

      const collision = await runCli(
        [
          ...addArgs.slice(0, 3),
          "--page-id",
          "another-page",
          ...addArgs.slice(5),
        ],
        homeDir,
      );
      expect(collision.exitCode).toBe(1);
      expect(collision.stderr.includes("another Page create")).toBe(true);
      const collisionMutation = mutations[mutations.length - 1];
      expect(collisionMutation?.operationId).toBe("cli-create-stable");
      expect(
        (collisionMutation?.operation as Record<string, unknown>).pageId,
      ).toBe("another-page");

      const remove = await runCli(
        [
          "rm",
          "page-existing",
          "--mutation-id",
          "cli-delete-stable",
          "--project",
          "default",
          "--url",
          baseUrl,
          "--json",
        ],
        homeDir,
      );
      expect(remove.exitCode).toBe(0);
      const deleteMutation = mutations.find(
        (mutation) =>
          (mutation.operation as Record<string, unknown>).kind === "delete_page",
      );
      expect(deleteMutation?.operationId).toBe("cli-delete-stable");
      expect(
        (deleteMutation?.operation as Record<string, unknown>)
          .expectedMetadataRevision,
      ).toBe(4);
      expect(
        (deleteMutation?.operation as Record<string, unknown>)
          .expectedParentRevision,
      ).toBe(6);
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
