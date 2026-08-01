import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CORE_TRANSPORT_BUDGETS } from "@nodex/core-protocol";

import type { CoreEventReplayRequired } from "./types";
import {
  CoreEventCompatibilityError,
  CoreEventReplayError,
  CoreResponseTooLargeError,
  CoreTransportError,
  UdsHttpTransport,
  isDefinitiveCoreGenerationLoss,
} from "./uds-http";

const servers: Server[] = [];
const directories: string[] = [];

const replayBoundary: CoreEventReplayRequired = {
  requested_after: 4,
  oldest_available: 7,
  event_head: 12,
};

const configureEventContract = (transport: UdsHttpTransport): UdsHttpTransport => {
  transport.configureEventContract({
    transportVersion: 4,
    eventVersion: 2,
    storeEpoch: "epoch-1",
  });
  return transport;
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

const serveCommittedEvent = async (event: unknown): Promise<string> => {
  const directory = mkdtempSync(path.join(tmpdir(), "nodex-core-uds-test-"));
  directories.push(directory);
  const socketPath = path.join(directory, "core.sock");
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    response.end(`event: module\ndata: ${JSON.stringify(event)}\n\n`);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
};

const servePendingResponse = async (): Promise<string> => {
  const directory = mkdtempSync(path.join(tmpdir(), "nodex-core-uds-test-"));
  directories.push(directory);
  const socketPath = path.join(directory, "core.sock");
  const server = createServer(() => {
    // Keep the request pending so the caller owns cancellation.
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
};

const serveJsonResponse = async (
  serialized: string,
  mode: "content-length" | "chunked" = "content-length",
  declaredLength?: number,
): Promise<string> => {
  const directory = mkdtempSync(path.join(tmpdir(), "nodex-core-uds-test-"));
  directories.push(directory);
  const socketPath = path.join(directory, "core.sock");
  const server = createServer((_request, response) => {
    if (mode === "content-length") {
      response.writeHead(200, {
        "content-length": declaredLength ?? Buffer.byteLength(serialized),
        "content-type": "application/json",
        connection: "close",
      });
      response.end(serialized);
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "transfer-encoding": "chunked",
      connection: "close",
    });
    const midpoint = Math.floor(serialized.length / 2);
    response.write(serialized.slice(0, midpoint));
    response.end(serialized.slice(midpoint));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
};

const committedEvent = () => ({
  transport_version: 4,
  event: {
    event_version: 2,
    sequence: 1,
    store_epoch: "epoch-1",
    operation_id: null,
    committed_at: "2026-07-22T00:00:00.000Z",
    projection_impact: { kind: "none" },
    payload: {
      module: "project_workspace",
      event: {
        kind: "project_workspace_changed",
        project_ids: [],
        catalog_change: "none",
        session_invalidation: "none",
      },
    },
  },
});

const serveLargeCommittedEvent = async (): Promise<string> =>
  await serveCommittedEvent({
    transport_version: 4,
    event: {
      event_version: 2,
      sequence: 1,
      store_epoch: "epoch-1",
      operation_id: null,
      committed_at: "2026-07-22T00:00:00.000Z",
      projection_impact: {
        kind: "resources",
        page_ids: Array.from(
          { length: 1_400 },
          (_, index) => `page-${index.toString().padStart(4, "0")}-${"p".repeat(480)}`,
        ),
        database_ids: [],
        data_source_ids: [],
        view_ids: [],
        document_heads: [],
      },
      payload: {
        module: "project_workspace",
        event: {
          kind: "project_workspace_changed",
          project_ids: [],
          catalog_change: "none",
          session_invalidation: "none",
        },
      },
    },
  });

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
  test("classifies a missing Core socket as definitive generation loss", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nodex-core-uds-missing-"));
    directories.push(directory);
    const transport = new UdsHttpTransport(
      path.join(directory, "core.sock"),
      "test-capability",
    );

    const error = await transport.requestJson("GET", "/core/v1/health")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "ENOENT",
      kind: "unreachable",
      name: "CoreTransportError",
      phase: "connect",
    });
    expect(isDefinitiveCoreGenerationLoss(error)).toBe(true);
  });

  test("keeps response timeouts distinct from generation loss", async () => {
    const transport = new UdsHttpTransport(
      await servePendingResponse(),
      "test-capability",
      { requestTimeoutMs: 10 },
    );

    const error = await transport.requestJson("GET", "/core/v1/health")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CoreTransportError);
    expect(error).toMatchObject({ kind: "timeout", phase: "response" });
    expect(isDefinitiveCoreGenerationLoss(error)).toBe(false);
  });

  test("bounds caller-specific response and timeout budgets", () => {
    expect(() => new UdsHttpTransport("/tmp/core.sock", "capability", {
      maximumJsonResponseBytes:
        CORE_TRANSPORT_BUDGETS.ordinary_json_response_bytes + 1,
    })).toThrow("Core JSON response limit must be a positive integer");
    expect(() => new UdsHttpTransport("/tmp/core.sock", "capability", {
      requestTimeoutMs: 120_001,
    })).toThrow("Core request timeout must be a positive integer");
    expect(() => new UdsHttpTransport("/tmp/core.sock", "capability", {
      maximumJsonResponseBytes:
        CORE_TRANSPORT_BUDGETS.ordinary_json_response_bytes,
      requestTimeoutMs: 60_000,
    })).not.toThrow();
  });

  test("reads an ordinary JSON response larger than the legacy 512 KiB limit", async () => {
    const value = "x".repeat(600 * 1024);
    const transport = new UdsHttpTransport(
      await serveJsonResponse(JSON.stringify({ value })),
      "test-capability",
    );

    await expect(
      transport.requestJson<{ readonly value: string }>("GET", "/core/v1/health"),
    ).resolves.toEqual({ value });
  });

  test("rejects an oversized declared ordinary JSON response before reading it", async () => {
    const maximum = CORE_TRANSPORT_BUDGETS.ordinary_json_response_bytes;
    const transport = new UdsHttpTransport(
      await serveJsonResponse("{}", "content-length", maximum + 1),
      "test-capability",
    );

    await expect(
      transport.requestJson("GET", "/core/v1/health"),
    ).rejects.toEqual(new CoreResponseTooLargeError(maximum, maximum + 1));
  });

  test("rejects an oversized chunked ordinary JSON response while streaming it", async () => {
    const maximum = CORE_TRANSPORT_BUDGETS.ordinary_json_response_bytes;
    const serialized = JSON.stringify({ value: "x".repeat(maximum) });
    const transport = new UdsHttpTransport(
      await serveJsonResponse(serialized, "chunked"),
      "test-capability",
    );

    await expect(
      transport.requestJson("GET", "/core/v1/health"),
    ).rejects.toMatchObject({
      name: "CoreResponseTooLargeError",
      maximumBytes: maximum,
    });
  });

  test("delivers an explicit resync boundary to a registered consumer", async () => {
    const transport = configureEventContract(
      new UdsHttpTransport(await serveReplayBoundary(), "test-capability"),
    );
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
    const transport = configureEventContract(
      new UdsHttpTransport(await serveReplayBoundary(), "test-capability"),
    );
    const subscription = await transport.openEventStream(4, () => undefined);

    await expect(subscription.done).rejects.toEqual(
      new CoreEventReplayError(replayBoundary),
    );
  });

  test("accepts a legal committed event larger than the old 512 KiB budget", async () => {
    const transport = configureEventContract(
      new UdsHttpTransport(
        await serveLargeCommittedEvent(),
        "test-capability",
      ),
    );
    let sequence: number | undefined;
    const subscription = await transport.openEventStream(0, (envelope) => {
      sequence = envelope.event.sequence;
    });

    await expect(subscription.done).resolves.toBeUndefined();
    expect(sequence).toBe(1);
  });

  test("rejects a legacy transport envelope before delivering it", async () => {
    const event = committedEvent();
    event.transport_version = 2;
    const transport = configureEventContract(
      new UdsHttpTransport(await serveCommittedEvent(event), "test-capability"),
    );
    let deliveries = 0;
    const subscription = await transport.openEventStream(0, () => {
      deliveries += 1;
    });

    await expect(subscription.done).rejects.toEqual(
      new CoreEventCompatibilityError("Core event transport version is invalid"),
    );
    expect(deliveries).toBe(0);
  });

  test("rejects a committed event without Projection impact before delivery", async () => {
    const event: { transport_version: number; event: Record<string, unknown> } =
      committedEvent();
    delete event.event.projection_impact;
    const transport = configureEventContract(
      new UdsHttpTransport(await serveCommittedEvent(event), "test-capability"),
    );
    let deliveries = 0;
    const subscription = await transport.openEventStream(0, () => {
      deliveries += 1;
    });

    await expect(subscription.done).rejects.toEqual(
      new CoreEventCompatibilityError("Core event payload is invalid"),
    );
    expect(deliveries).toBe(0);
  });

  test("aborts an event stream that has not received response headers", async () => {
    const transport = configureEventContract(
      new UdsHttpTransport(await servePendingResponse(), "test-capability"),
    );
    const controller = new AbortController();
    const opening = transport.openEventStream(
      0,
      () => undefined,
      {},
      undefined,
      undefined,
      undefined,
      controller.signal,
    );

    controller.abort(new Error("subscription closed"));

    await expect(opening).rejects.toMatchObject({ code: "ABORT_ERR" });
  });
});
