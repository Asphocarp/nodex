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
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> =>
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

const readJsonBody = (chunks: readonly Buffer[]): Readonly<Record<string, unknown>> => {
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0
    ? {}
    : (JSON.parse(raw) as Readonly<Record<string, unknown>>);
};

describe("Card Document CLI", () => {
  test("routes title/body and stable-ID operations through exact-head Document mutations", async () => {
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-document-cli-home-"),
    );
    const inputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-document-cli-input-"),
    );
    const nfmPath = path.join(inputDir, "body.nfm");
    const operationsPath = path.join(inputDir, "operations.json");
    fs.writeFileSync(nfmPath, "Body from CLI", "utf8");
    fs.writeFileSync(
      operationsPath,
      JSON.stringify([
        {
          kind: "update_block",
          blockId: "stable-block",
          patch: { content: "Updated" },
        },
      ]),
      "utf8",
    );

    const requests: CapturedRequest[] = [];
    const descriptor = {
      documentId: "document:card-1",
      ownerBlockId: "card-1",
      ownerType: "card",
      projectId: "default",
      generation: 1,
      headSeq: 7,
      schemaKey: "nodex.card",
      schemaVersion: 1,
      readiness: "ready",
      authority: "ydoc_primary",
      storeEpoch: "epoch-1",
    };
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const body = readJsonBody(chunks);
        requests.push({
          method: request.method ?? "GET",
          pathname: url.pathname,
          body,
        });

        if (
          request.method === "POST" &&
          url.pathname ===
            "/api/projects/default/blocks/card-1/document/prepare"
        ) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(descriptor));
          return;
        }
        if (
          request.method === "POST" &&
          url.pathname ===
            "/api/projects/default/documents/document%3Acard-1/mutations"
        ) {
          const expectedHeadSeq = body.expectedHeadSeq as number;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              ok: true,
              value: {
                mutationId: body.mutationId,
                headSeq: expectedHeadSeq + 1,
                duplicate: false,
              },
            }),
          );
          return;
        }
        if (
          request.method === "PUT" &&
          url.pathname === "/api/projects/default/card"
        ) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ status: "updated" }));
          return;
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/projects/default/card"
        ) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              id: "card-1",
              title: "Original",
              description: "Original body",
            }),
          );
          return;
        }
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not start CLI test server");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const updated = await runCli(
        [
          "update",
          "card-1",
          "--title",
          "Collaborative title",
          "--description",
          `@${nfmPath}`,
          "--priority",
          "p1-high",
          "--mutation-id",
          "cli-update",
          "--expected-head",
          "7",
          "--url",
          baseUrl,
          "--project",
          "default",
          "--json",
        ],
        homeDir,
      );
      if (updated.exitCode !== 0) {
        throw new Error(
          `CLI update failed: ${updated.stderr}; requests=${JSON.stringify(requests)}`,
        );
      }
      expect(updated.exitCode).toBe(0);
      const updateOutput = JSON.parse(updated.stdout) as {
        readonly documentMutations: readonly { readonly mutationId: string }[];
      };
      expect(updateOutput.documentMutations.length).toBe(2);
      expect(updateOutput.documentMutations[0]?.mutationId).toBe(
        "cli-update:body",
      );
      expect(updateOutput.documentMutations[1]?.mutationId).toBe(
        "cli-update:title",
      );

      const legacyUpdate = requests.find(
        (entry) =>
          entry.method === "PUT" &&
          entry.pathname === "/api/projects/default/card",
      );
      expect(legacyUpdate?.body.priority).toBe("p1-high");
      expect(Object.hasOwn(legacyUpdate?.body ?? {}, "title")).toBe(false);
      expect(Object.hasOwn(legacyUpdate?.body ?? {}, "description")).toBe(false);

      const documentMutations = requests.filter(
        (entry) => entry.pathname.endsWith("/mutations"),
      );
      expect(documentMutations.length).toBe(2);
      expect(documentMutations[0]?.body.expectedHeadSeq).toBe(7);
      expect(documentMutations[0]?.body.mutationId).toBe("cli-update:body");
      expect(documentMutations[0]?.body.nfm).toBe("Body from CLI");
      expect(documentMutations[1]?.body.expectedHeadSeq).toBe(8);
      expect(documentMutations[1]?.body.mutationId).toBe("cli-update:title");
      expect(
        JSON.stringify(documentMutations[1]?.body.operations).includes(
          "Collaborative title",
        ),
      ).toBe(true);

      const applied = await runCli(
        [
          "block",
          "apply",
          "card-1",
          `@${operationsPath}`,
          "--mutation-id",
          "cli-stable-block",
          "--expected-head",
          "11",
          "--url",
          baseUrl,
          "--project",
          "default",
          "--json",
        ],
        homeDir,
      );
      expect(applied.exitCode).toBe(0);
      const stableMutation = requests.filter(
        (entry) => entry.pathname.endsWith("/mutations"),
      )[2];
      expect(stableMutation?.body.mutationId).toBe("cli-stable-block");
      expect(stableMutation?.body.expectedHeadSeq).toBe(11);
      expect(
        JSON.stringify(stableMutation?.body.operations).includes(
          "stable-block",
        ),
      ).toBe(true);
    } finally {
      server.close();
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(inputDir, { recursive: true, force: true });
    }
  });
});
