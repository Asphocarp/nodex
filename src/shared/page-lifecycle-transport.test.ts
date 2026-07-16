import { describe, expect, test } from "vitest";
import {
  bindTrustedPageLifecycleMutation,
  pageLifecycleMutationHttpStatus,
  parsePageLifecyclePreflightResult,
} from "./page-lifecycle-transport";

const request = {
  version: 1,
  operationId: "page-lifecycle-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed", userId: "admin" },
  operation: {
    kind: "archive_page",
    pageId: "card-1",
    expectedMetadataRevision: 2,
  },
} as const;

describe("Page lifecycle transport binding", () => {
  test("replaces untrusted audit identity while preserving logical intent", () => {
    const result = bindTrustedPageLifecycleMutation(request, "project-1", {
      actor: { kind: "electron", webContentsId: 7 },
      clientSessionId: "renderer-7",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operationId).toBe("page-lifecycle-1");
    expect(result.value.projectId).toBe("project-1");
    expect(result.value.clientSessionId).toBe("renderer-7");
    expect(result.value.actor.kind).toBe("electron");
    expect(result.value.actor.webContentsId).toBe(7);
    expect(result.value.actor.userId === undefined).toBe(true);
  });

  test("rejects malformed and cross-Project envelopes with stable hints", () => {
    const wrongProject = bindTrustedPageLifecycleMutation(
      request,
      "project-2",
      { actor: { kind: "http_loopback" } },
    );
    expect(wrongProject.ok).toBe(false);
    if (wrongProject.ok) return;
    expect(wrongProject.error.code).toBe("invalid_page_lifecycle_request");
    expect(wrongProject.error.operationId).toBe("page-lifecycle-1");
    expect(wrongProject.error.pageId).toBe("card-1");

    const malformed = bindTrustedPageLifecycleMutation(
      { ...request, version: 2 },
      "project-1",
      { actor: { kind: "http_loopback" } },
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.error.operationId).toBe("page-lifecycle-1");
    expect(malformed.error.pageId).toBe("card-1");
  });

  test("maps lifecycle failures to stable HTTP semantics", () => {
    expect(
      pageLifecycleMutationHttpStatus({
        code: "page_not_found",
        message: "missing",
        retryable: false,
      }),
    ).toBe(404);
    expect(
      pageLifecycleMutationHttpStatus({
        code: "delete_evidence_invalid",
        message: "stale delete",
        retryable: false,
      }),
    ).toBe(409);
    expect(
      pageLifecycleMutationHttpStatus({
        code: "database_property_value_invalid",
        message: "invalid value",
        retryable: false,
      }),
    ).toBe(400);
  });

  test("parses canonical preflight failures without the legacy Database error vocabulary", () => {
    expect(
      parsePageLifecyclePreflightResult({
        ok: false,
        error: {
          code: "authorization_denied",
          message: "grant missing",
          retryable: false,
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "authorization_denied",
        message: "grant missing",
        retryable: false,
      },
    });
    expect(() =>
      parsePageLifecyclePreflightResult({
        ok: false,
        error: { code: "database_state_corrupt", message: "old", retryable: false },
      }),
    ).toThrow("Page lifecycle preflight error is invalid");
  });
});
