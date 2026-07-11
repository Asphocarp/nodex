import { describe, expect, test } from "vitest";
import {
  bindTrustedBlockPropertyMutation,
  blockPropertyMutationHttpStatus,
} from "./block-property-mutation-transport";

const request = {
  version: 1,
  mutationId: "mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed", userId: "admin" },
  fields: [
    {
      scope: "intrinsic",
      blockId: "card-1",
      propertyKey: "agent.status",
      operation: "set",
      expectedRevision: 1,
      value: "running",
    },
  ],
} as const;

describe("Block property mutation transport binding", () => {
  test("replaces untrusted actor and session while preserving the envelope", () => {
    const result = bindTrustedBlockPropertyMutation(request, "project-1", {
      actor: { kind: "electron", clientId: "renderer-7" },
      clientSessionId: "renderer-7",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
    expect(result.value.mutationId).toBe("mutation-1");
    expect(result.value.projectId).toBe("project-1");
    expect(result.value.storeEpoch).toBe("epoch-1");
    expect(result.value.clientSessionId).toBe("renderer-7");
    expect(result.value.actor.kind).toBe("electron");
    expect(result.value.actor.clientId).toBe("renderer-7");
    expect(result.value.actor.userId === undefined).toBe(true);
  });

  test("rejects route scope mismatches and malformed envelopes as typed errors", () => {
    const wrongProject = bindTrustedBlockPropertyMutation(
      request,
      "project-2",
      { actor: { kind: "http_loopback" } },
    );
    expect(wrongProject.ok).toBe(false);
    if (wrongProject.ok) return;
    expect(wrongProject.error.code).toBe("invalid_property_mutation_request");
    expect(wrongProject.error.mutationId).toBe("mutation-1");

    const malformed = bindTrustedBlockPropertyMutation(
      { ...request, version: 2 },
      "project-1",
      { actor: { kind: "http_loopback" } },
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.error.code).toBe("invalid_property_mutation_request");
  });

  test("maps typed failures to stable HTTP conflict and scope statuses", () => {
    expect(
      blockPropertyMutationHttpStatus({
        code: "property_conflict",
        message: "stale",
        retryable: false,
      }),
    ).toBe(409);
    expect(
      blockPropertyMutationHttpStatus({
        code: "block_not_found",
        message: "missing",
        retryable: false,
      }),
    ).toBe(404);
    expect(
      blockPropertyMutationHttpStatus({
        code: "property_type_mismatch",
        message: "invalid",
        retryable: false,
      }),
    ).toBe(400);
  });
});
