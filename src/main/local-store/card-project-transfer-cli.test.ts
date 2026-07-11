import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

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

describe("Card Project transfer CLI", () => {
  test("submits stable logical intent without compiled authority coordinates", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-transfer-cli-home-"),
    );
    let capturedPath = "";
    let capturedBody: Readonly<Record<string, unknown>> = {};
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        capturedPath = new URL(
          request.url ?? "/",
          "http://127.0.0.1",
        ).pathname;
        capturedBody = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as Readonly<Record<string, unknown>>;
        const target = capturedBody.target as Readonly<
          Record<string, unknown>
        >;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            value: {
              operationId: capturedBody.operationId,
              cardId: capturedBody.cardId,
              targetDatabaseBlockId: target.databaseBlockId,
              targetViewId: target.viewId,
              duplicate: false,
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not start CLI fixture server");
      }
      const result = await runCli(
        [
          "transfer",
          "card-1",
          "project-b",
          "in-progress",
          "--project",
          "project-a",
          "--target-database",
          "database-b",
          "--target-view",
          "view-b",
          "--before-card",
          "card-anchor",
          "--mutation-id",
          "transfer-cli-1",
          "--url",
          `http://127.0.0.1:${address.port}`,
          "--json",
        ],
        homeDir,
      );
      expect(result.exitCode).toBe(0);
      expect(capturedPath).toBe(
        "/api/projects/project-a/card-transfers",
      );
      expect(capturedBody.operationId).toBe("transfer-cli-1");
      expect(capturedBody.sourceProjectId).toBe("project-a");
      expect(capturedBody.targetProjectId).toBe("project-b");
      expect(Object.hasOwn(capturedBody, "expectedDocuments")).toBe(false);
      const target = capturedBody.target as Readonly<Record<string, unknown>>;
      expect(target.status).toBe("in_progress");
      expect(target.beforeBlockId).toBe("card-anchor");
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
