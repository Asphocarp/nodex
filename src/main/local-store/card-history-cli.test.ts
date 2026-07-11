import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

const runCli = (
  args: readonly string[],
  homeDir: string,
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "bin", "nodex.mjs"), ...args],
      {
        env: { ...process.env, HOME: homeDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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

describe("Card history CLI", () => {
  test("reads only the canonical Card-scoped cursor endpoint", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-card-history-cli-home-"),
    );
    const requests: string[] = [];
    const page = {
      version: 1,
      projectId: "default",
      cardBlockId: "card/one",
      documentId: "document/one",
      entries: [
        {
          id: "change_log:41",
          kind: "block_mutation",
          projectId: "default",
          cardBlockId: "card/one",
          documentId: "document/one",
          occurredAt: "2026-07-12T07:59:00.000Z",
          display: {
            category: "property",
            title: "Priority changed",
            detail: "p2-medium → p1-high",
            actorLabel: "CLI",
          },
          evidence: { status: "verified" },
          recovery: { kind: "unavailable", reason: "no_inverse_contract" },
          changeSeq: 41,
          mutationId: "metadata:41",
          mutationKind: "block_property_batch",
          affectedBlockCount: 1,
          fieldIntentCount: 1,
        },
      ],
      nextCursor: {
        source: "change_log",
        occurredAt: "2026-07-12T07:59:00.000Z",
        changeSeq: 41,
      },
    };
    const server = http.createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, value: page }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not start Card history CLI test server");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await runCli(
        [
          "history",
          "card/one",
          "--limit",
          "20",
          "--before-source",
          "change_log",
          "--before-occurred-at",
          "2026-07-12T08:00:00.000Z",
          "--before-change-seq",
          "42",
          "--project",
          "default",
          "--url",
          baseUrl,
          "--json",
        ],
        homeDir,
      );
      expect(result.exitCode).toBe(0);
      expect(requests.length).toBe(1);
      const request = new URL(requests[0] ?? "/", baseUrl);
      expect(request.pathname).toBe(
        "/api/projects/default/cards/card%2Fone/history",
      );
      expect(request.searchParams.get("pageSize")).toBe("20");
      expect(request.searchParams.get("beforeSource")).toBe("change_log");
      expect(request.searchParams.get("beforeChangeSeq")).toBe("42");
      expect(request.searchParams.get("beforeVersionId")).toBe(null);

      const output = JSON.parse(result.stdout) as typeof page;
      expect(output.entries[0]?.id).toBe("change_log:41");
      expect(output.nextCursor?.changeSeq).toBe(41);

      const missingCard = await runCli(
        ["history", "--project", "default", "--url", baseUrl],
        homeDir,
      );
      expect(missingCard.exitCode).toBe(1);
      expect(missingCard.stderr.includes("history <card-id>")).toBe(true);

      const malformedCursor = await runCli(
        [
          "history",
          "card/one",
          "--before-source",
          "document_version",
          "--before-occurred-at",
          "2026-07-12T08:00:00.000Z",
          "--project",
          "default",
          "--url",
          baseUrl,
        ],
        homeDir,
      );
      expect(malformedCursor.exitCode).toBe(1);
      expect(malformedCursor.stderr.includes("--before-version-id")).toBe(true);
      expect(requests.length).toBe(1);

      const removedUndo = await runCli(
        ["undo", "--project", "default", "--url", baseUrl],
        homeDir,
      );
      expect(removedUndo.exitCode).toBe(1);
      expect(removedUndo.stderr.includes("Unknown command: undo")).toBe(true);
      expect(requests.length).toBe(1);
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
