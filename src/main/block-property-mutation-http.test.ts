import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type {
  BlockPropertyMutationCommandErrorV2,
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
} from "../shared/block-property-mutations-v2";
import { registerBlockPropertyMutationHttpRoute } from "./block-property-mutation-http";

const request: BlockPropertyMutationRequestV2 = {
  version: 2,
  mutationId: "mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed", userId: "admin" },
  fields: [
    {
      scope: "intrinsic",
      blockId: "card-1",
      propertyKey: "run.baseBranch",
      operation: "set",
      expectedRevision: 1,
      value: "running",
    },
  ],
};

const success = (
  bound: BlockPropertyMutationRequestV2,
): BlockPropertyMutationCommandResultV2 => ({
  ok: true,
  value: {
    version: 2,
    mutationId: bound.mutationId,
    projectId: bound.projectId,
    storeEpoch: bound.storeEpoch,
    duplicate: false,
    fields: [
      {
        path: "intrinsic/card-1/run.baseBranch",
        scope: "intrinsic",
        blockId: "card-1",
        propertyKey: "run.baseBranch",
        operation: "set",
        revision: 2,
        value: "running",
      },
    ],
    blockMetadataRevisions: { "card-1": 2 },
    changeLogSeq: 1,
    committedAt: "2026-07-11T00:00:00.000Z",
  },
});

const failure = (
  code: BlockPropertyMutationCommandErrorV2["code"],
): BlockPropertyMutationCommandResultV2 => ({
  ok: false,
  error: {
    code,
    message: code,
    retryable: false,
    mutationId: "mutation-1",
  },
});

const createApp = (
  applyMutation: (
    request: BlockPropertyMutationRequestV2,
  ) => Promise<BlockPropertyMutationCommandResultV2>,
): Hono => {
  const app = new Hono();
  registerBlockPropertyMutationHttpRoute(app, { applyMutation });
  return app;
};

const post = async (
  app: Hono,
  projectId: string,
  body: unknown,
): Promise<Response> =>
  await app.request(`/api/projects/${projectId}/block-property-mutations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Block property mutation HTTP route", () => {
  test("binds a loopback audit identity and returns the shared receipt", async () => {
    const captured: BlockPropertyMutationRequestV2[] = [];
    const app = createApp(async (bound) => {
      captured.push(bound);
      return success(bound);
    });
    const response = await post(app, "project-1", request);
    const result =
      (await response.json()) as BlockPropertyMutationCommandResultV2;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result.ok).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]?.mutationId).toBe("mutation-1");
    expect(captured[0]?.clientSessionId).toBe("http-loopback");
    expect(captured[0]?.actor.kind).toBe("http_loopback");
    expect(captured[0]?.actor.userId === undefined).toBe(true);
  });

  test("maps typed conflicts and missing scope to stable HTTP statuses", async () => {
    const conflict = await post(
      createApp(async () => failure("property_conflict")),
      "project-1",
      request,
    );
    expect(conflict.status).toBe(409);
    const conflictBody =
      (await conflict.json()) as BlockPropertyMutationCommandResultV2;
    expect(conflictBody.ok).toBe(false);

    const missing = await post(
      createApp(async () => failure("block_not_found")),
      "project-1",
      request,
    );
    expect(missing.status).toBe(404);
  });

  test("rejects Project spoofing before the writer", async () => {
    let calls = 0;
    const response = await post(
      createApp(async (bound) => {
        calls += 1;
        return success(bound);
      }),
      "project-2",
      request,
    );
    const result =
      (await response.json()) as BlockPropertyMutationCommandResultV2;
    expect(response.status).toBe(400);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("rejects legacy v1 requests before the writer", async () => {
    let calls = 0;
    const response = await post(
      createApp(async (bound) => {
        calls += 1;
        return success(bound);
      }),
      "project-1",
      { ...request, version: 1 },
    );
    const result =
      (await response.json()) as BlockPropertyMutationCommandResultV2;

    expect(response.status).toBe(400);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("keeps writer outages inside a retryable typed envelope", async () => {
    const response = await post(
      createApp(async () => {
        throw new Error("worker offline");
      }),
      "project-1",
      request,
    );
    const result =
      (await response.json()) as BlockPropertyMutationCommandResultV2;
    expect(response.status).toBe(500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown");
    expect(result.error.retryable).toBe(true);
    expect(result.error.mutationId).toBe("mutation-1");
  });
});
