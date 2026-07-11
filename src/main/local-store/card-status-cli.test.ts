import { describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

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

describe("card status CLI arguments", () => {
  test("accepts canonical statuses and ergonomic aliases, and rejects legacy shorthands", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-status-cli-home-"));
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    let createdCardId = "";
    let createdStatus = "draft";

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
          res.end(JSON.stringify({ id: url.searchParams.get("id"), name: "In Progress", cards: [] }));
          return;
        }

        if (
          method === "GET" &&
          url.pathname === "/api/projects/default/card-lifecycle-preflight"
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 1,
              projectId: "default",
              storeEpoch: "epoch-1",
              changeLogSeq: 1,
              value: {
                version: 1,
                reservedBlockType: null,
                card: null,
              },
            },
          }));
          return;
        }

        if (
          method === "POST" &&
          url.pathname === "/api/projects/default/card-lifecycle-mutations"
        ) {
          const operation = body?.operation as Record<string, unknown> | undefined;
          createdCardId = String(operation?.cardId ?? "");
          createdStatus = String(operation?.status ?? "draft");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 1,
              operationId: body?.operationId,
              projectId: "default",
              storeEpoch: "epoch-1",
              operationKind: "create_card",
              cardId: createdCardId,
              duplicate: false,
              lifecycle: "active",
            },
          }));
          return;
        }

        if (
          method === "GET" &&
          url.pathname === "/api/projects/default/card" &&
          url.searchParams.get("cardId") === createdCardId
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: createdCardId,
            status: createdStatus,
            archived: false,
            title: "Ship it",
            description: "",
            priority: "p2-medium",
            tags: [],
            agentBlocked: false,
            created: "2026-03-12T00:00:00.000Z",
            order: 0,
          }));
          return;
        }

        if (method === "GET" && url.pathname === "/api/projects/default/card") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "card-1",
            status: "done",
            archived: false,
            title: "Ship it",
            description: "",
            priority: "p2-medium",
            tags: [],
            agentBlocked: false,
            created: "2026-03-12T00:00:00.000Z",
            order: 0,
          }));
          return;
        }

        if (method === "PUT" && url.pathname === "/api/projects/default/move") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
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

      const lsResult = await runCli(["ls", "in-progress", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(lsResult.exitCode).toBe(0);

      const addResult = await runCli(["add", "in-review", "Ship it", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(addResult.exitCode).toBe(0);

      const moveResult = await runCli(["mv", "card-1", "in-progress", "done", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(moveResult.exitCode).toBe(0);

      const legacyNumeric = await runCli(["ls", "5", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(legacyNumeric.exitCode).toBe(1);
      expect(legacyNumeric.stderr.includes("Unknown status")).toBeTrue();

      const legacyReady = await runCli(["ls", "5-ready", "--project", "default", "--url", baseUrl, "--json"], homeDir);
      expect(legacyReady.exitCode).toBe(1);
      expect(legacyReady.stderr.includes("Unknown status")).toBeTrue();

      const listRequest = requests.find((request) => request.method === "GET");
      expect(listRequest?.path).toBe("/api/projects/default/column?id=in_progress");

      const createRequest = requests.find(
        (request) =>
          request.method === "POST" &&
          (request.body?.operation as Record<string, unknown> | undefined)?.kind ===
            "create_card",
      );
      expect(
        (createRequest?.body?.operation as Record<string, unknown> | undefined)
          ?.status,
      ).toBe("in_review");

      const moveRequest = requests.find((request) => request.method === "PUT");
      expect(moveRequest?.body?.fromStatus).toBe("in_progress");
      expect(moveRequest?.body?.toStatus).toBe("done");
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
    let createdCardId = "";
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
          url.pathname === "/api/projects/default/card-lifecycle-preflight"
        ) {
          const cardId = url.searchParams.get("cardId") ?? "";
          const existingCard =
            cardId === "card-existing" ||
            (createdCardId.length > 0 && cardId === createdCardId)
            ? {
                cardId,
                lifecycle: "active",
                location: { kind: "space", rankKey: "m" },
                metadataRevision: 4,
                locationRevision: 6,
              }
            : null;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 1,
              projectId: "default",
              storeEpoch: "epoch-1",
              changeLogSeq: 3,
              value: {
                version: 1,
                reservedBlockType: null,
                card: existingCard,
              },
            },
          }));
          return;
        }

        if (
          method === "POST" &&
          url.pathname === "/api/projects/default/card-lifecycle-mutations" &&
          body
        ) {
          mutations.push(body);
          const operation = body.operation as Record<string, unknown>;
          if (operation.kind === "create_card") {
            const requestedCardId = String(operation.cardId);
            if (
              createdCardId.length > 0 &&
              requestedCardId !== createdCardId &&
              body.operationId === "cli-create-stable"
            ) {
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                ok: false,
                error: {
                  code: "operation_id_collision",
                  message: "Operation identity names another Card create",
                  retryable: false,
                  operationId: body.operationId,
                  cardId: requestedCardId,
                },
              }));
              return;
            }
            createAttempts += 1;
            createdCardId = requestedCardId;
            if (createAttempts === 1) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                ok: false,
                error: {
                  code: "unknown",
                  message: "response outcome unavailable",
                  retryable: true,
                  operationId: body.operationId,
                  cardId: createdCardId,
                },
              }));
              return;
            }
          } else if (operation.kind === "delete_card") {
            deleted = true;
          }
          const lifecycle = operation.kind === "delete_card" ? "deleted" : "active";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            value: {
              version: 1,
              operationId: body.operationId,
              projectId: "default",
              storeEpoch: "epoch-1",
              operationKind: operation.kind,
              cardId: operation.cardId,
              duplicate: createAttempts > 1,
              lifecycle,
            },
          }));
          return;
        }

        if (method === "GET" && url.pathname === "/api/projects/default/card") {
          const cardId = url.searchParams.get("cardId") ?? "";
          if (cardId === "card-existing" && deleted) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }
          const isCreated = cardId === createdCardId;
          if (isCreated || cardId === "card-existing") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              id: cardId,
              status: "draft",
              archived: false,
              title: isCreated ? "Exact retry" : "Existing",
              description: "",
              tags: [],
              agentBlocked: false,
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
          "draft",
          "Unsafe retry",
          "--mutation-id",
          "operation-without-card-id",
          "--project",
          "default",
          "--url",
          baseUrl,
        ],
        homeDir,
      );
      expect(unsafeRetryIdentity.exitCode).toBe(1);
      expect(unsafeRetryIdentity.stderr.includes("requires --card-id")).toBeTrue();

      const addArgs = [
        "add",
        "draft",
        "Exact retry",
        "--card-id",
        "card-create-stable",
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
          (mutation.operation as Record<string, unknown>).kind === "create_card",
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
          .cardId,
      ).toBe("card-create-stable");

      const collision = await runCli(
        [
          ...addArgs.slice(0, 3),
          "--card-id",
          "another-card",
          ...addArgs.slice(5),
        ],
        homeDir,
      );
      expect(collision.exitCode).toBe(1);
      expect(collision.stderr.includes("another Card create")).toBeTrue();
      const collisionMutation = mutations[mutations.length - 1];
      expect(collisionMutation?.operationId).toBe("cli-create-stable");
      expect(
        (collisionMutation?.operation as Record<string, unknown>).cardId,
      ).toBe("another-card");

      const remove = await runCli(
        [
          "rm",
          "card-existing",
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
          (mutation.operation as Record<string, unknown>).kind === "delete_card",
      );
      expect(deleteMutation?.operationId).toBe("cli-delete-stable");
      expect(
        (deleteMutation?.operation as Record<string, unknown>)
          .expectedMetadataRevision,
      ).toBe(4);
      expect(
        (deleteMutation?.operation as Record<string, unknown>)
          .expectedLocationRevision,
      ).toBe(6);
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
