import { describe, expect, test } from "vitest";
import {
  bindTrustedCardLifecycleMutation,
  cardLifecycleMutationHttpStatus,
} from "./card-lifecycle-transport";

const request = {
  version: 1,
  operationId: "card-lifecycle-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed", userId: "admin" },
  operation: {
    kind: "archive_card",
    cardId: "card-1",
    expectedMetadataRevision: 2,
  },
} as const;

describe("Card lifecycle transport binding", () => {
  test("replaces untrusted audit identity while preserving logical intent", () => {
    const result = bindTrustedCardLifecycleMutation(request, "project-1", {
      actor: { kind: "electron", webContentsId: 7 },
      clientSessionId: "renderer-7",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operationId).toBe("card-lifecycle-1");
    expect(result.value.projectId).toBe("project-1");
    expect(result.value.clientSessionId).toBe("renderer-7");
    expect(result.value.actor.kind).toBe("electron");
    expect(result.value.actor.webContentsId).toBe(7);
    expect(result.value.actor.userId === undefined).toBe(true);
  });

  test("rejects malformed and cross-Project envelopes with stable hints", () => {
    const wrongProject = bindTrustedCardLifecycleMutation(
      request,
      "project-2",
      { actor: { kind: "http_loopback" } },
    );
    expect(wrongProject.ok).toBe(false);
    if (wrongProject.ok) return;
    expect(wrongProject.error.code).toBe("invalid_card_lifecycle_request");
    expect(wrongProject.error.operationId).toBe("card-lifecycle-1");
    expect(wrongProject.error.cardId).toBe("card-1");

    const malformed = bindTrustedCardLifecycleMutation(
      { ...request, version: 2 },
      "project-1",
      { actor: { kind: "http_loopback" } },
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.error.operationId).toBe("card-lifecycle-1");
    expect(malformed.error.cardId).toBe("card-1");
  });

  test("maps lifecycle failures to stable HTTP semantics", () => {
    expect(
      cardLifecycleMutationHttpStatus({
        code: "card_not_found",
        message: "missing",
        retryable: false,
      }),
    ).toBe(404);
    expect(
      cardLifecycleMutationHttpStatus({
        code: "delete_evidence_invalid",
        message: "stale delete",
        retryable: false,
      }),
    ).toBe(409);
    expect(
      cardLifecycleMutationHttpStatus({
        code: "database_property_value_invalid",
        message: "invalid value",
        retryable: false,
      }),
    ).toBe(400);
  });
});
