import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { CoreEventReplayRequired } from "./types";
import { CoreEventReplayError, UdsHttpTransport } from "./uds-http";

const servers: Server[] = [];
const directories: string[] = [];

const replayBoundary: CoreEventReplayRequired = {
  requested_after: 4,
  oldest_available: 7,
  event_head: 12,
};

const serveReplayBoundary = async (): Promise<string> => {
  const directory = mkdtempSync(path.join(tmpdir(), "nodex-core-uds-test-"));
  directories.push(directory);
  const socketPath = path.join(directory, "core.sock");
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    response.end(
      `event: core-resync-required\ndata: ${JSON.stringify(replayBoundary)}\n\n`,
    );
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("UDS Core event replay boundaries", () => {
  test("bounds caller-specific response and timeout budgets", () => {
    expect(() => new UdsHttpTransport("/tmp/core.sock", "capability", {
      maximumJsonResponseBytes: 64 * 1024 * 1024 + 1,
    })).toThrow("Core JSON response limit must be a positive integer");
    expect(() => new UdsHttpTransport("/tmp/core.sock", "capability", {
      requestTimeoutMs: 120_001,
    })).toThrow("Core request timeout must be a positive integer");
    expect(() => new UdsHttpTransport("/tmp/core.sock", "capability", {
      maximumJsonResponseBytes: 16 * 1024 * 1024,
      requestTimeoutMs: 60_000,
    })).not.toThrow();
  });

  test("delivers an explicit resync boundary to a registered consumer", async () => {
    const transport = new UdsHttpTransport(await serveReplayBoundary(), "test-capability");
    let observed: CoreEventReplayRequired | undefined;

    const subscription = await transport.openEventStream(
      4,
      () => undefined,
      {},
      undefined,
      undefined,
      (boundary) => {
        observed = boundary;
      },
    );

    await expect(subscription.done).resolves.toBeUndefined();
    expect(observed).toEqual(replayBoundary);
  });

  test("fails closed when a resync boundary has no consumer", async () => {
    const transport = new UdsHttpTransport(await serveReplayBoundary(), "test-capability");
    const subscription = await transport.openEventStream(4, () => undefined);

    await expect(subscription.done).rejects.toEqual(
      new CoreEventReplayError(replayBoundary),
    );
  });
});
