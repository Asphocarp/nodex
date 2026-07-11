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

describe("Additional Document command CLI", () => {
  test("submits a portable command envelope through the Project route", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-additional-command-cli-home-"),
    );
    const inputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-additional-command-cli-input-"),
    );
    const commandPath = path.join(inputDir, "command.json");
    fs.writeFileSync(
      commandPath,
      JSON.stringify({
        storeEpoch: "epoch-1",
        coordination: { kind: "fifo_only" },
        operation: {
          kind: "create_template",
          sourceBlockId: "template-cli",
          documentId: "document-template-cli",
          displayName: "CLI template",
          initialBlocks: [],
          placement: { kind: "space" },
        },
      }),
      "utf8",
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
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            value: {
              operationId: capturedBody.operationId,
              operationKind: "create_template",
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
          "block",
          "command",
          `@${commandPath}`,
          "--mutation-id",
          "cli-additional-1",
          "--session-id",
          "cli-session-1",
          "--project",
          "project-1",
          "--url",
          `http://127.0.0.1:${address.port}`,
          "--json",
        ],
        homeDir,
      );
      expect(result.exitCode).toBe(0);
      expect(capturedPath).toBe(
        "/api/projects/project-1/document-commands",
      );
      expect(capturedBody.projectId).toBe("project-1");
      expect(capturedBody.operationId).toBe("cli-additional-1");
      expect(capturedBody.clientSessionId).toBe("cli-session-1");
      expect(
        (capturedBody.actor as Readonly<Record<string, unknown>>).kind,
      ).toBe("nodex_cli");
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(inputDir, { recursive: true, force: true });
    }
  });
});
