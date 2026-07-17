import { describe, expect, test } from "vitest";
import {
  bindTrustedBlockPropertyMutationV2,
  blockPropertyMutationHttpStatusV2,
  blockPropertyMutationTransportFailureV2,
} from "./block-property-mutation-v2-transport";

const request = {
  version: 2,
  mutationId: "mutation-v2-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed", userId: "admin" },
  fields: [
    {
      scope: "data_source",
      pageId: "page-1",
      dataSourceId: "source-1",
      propertyId: "tags",
      operation: "add_remove",
      add: ["o_AAAAAAAA"],
      remove: [],
    },
  ],
} as const;

describe("Block property mutation v2 transport binding", () => {
  test("binds Project scope and replaces caller-authored attribution", () => {
    const result = bindTrustedBlockPropertyMutationV2(request, "project-1", {
      actor: { kind: "electron", clientId: "renderer-7" },
      clientSessionId: "renderer-7",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      version: 2,
      mutationId: "mutation-v2-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      clientSessionId: "renderer-7",
      actor: { kind: "electron", clientId: "renderer-7" },
      fields: [
        {
          scope: "data_source",
          pageId: "page-1",
          dataSourceId: "source-1",
          propertyId: "tags",
          operation: "add_remove",
          add: ["o_AAAAAAAA"],
          remove: [],
        },
      ],
    });
    expect(result.value.actor.userId).toBeUndefined();
  });

  test("rejects malformed, cross-Project, and invalid host identity inputs", () => {
    const wrongProject = bindTrustedBlockPropertyMutationV2(
      request,
      "project-2",
      { actor: { kind: "http_loopback" } },
    );
    expect(wrongProject).toMatchObject({
      ok: false,
      error: {
        code: "invalid_property_mutation_request",
        mutationId: "mutation-v2-1",
      },
    });

    const malformed = bindTrustedBlockPropertyMutationV2(
      { ...request, version: 1 },
      "project-1",
      { actor: { kind: "http_loopback" } },
    );
    expect(malformed).toMatchObject({
      ok: false,
      error: {
        code: "invalid_property_mutation_request",
        mutationId: "mutation-v2-1",
      },
    });

    const invalidHost = bindTrustedBlockPropertyMutationV2(
      request,
      "project-1",
      {
        actor: { kind: undefined } as never,
        clientSessionId: "renderer-7",
      },
    );
    expect(invalidHost).toMatchObject({
      ok: false,
      error: {
        code: "invalid_property_mutation_request",
        mutationId: "mutation-v2-1",
      },
    });
  });

  test("preserves v2 HTTP and writer-failure semantics", () => {
    expect(
      blockPropertyMutationHttpStatusV2({
        code: "data_source_not_found",
        message: "missing",
        retryable: false,
      }),
    ).toBe(404);
    expect(
      blockPropertyMutationHttpStatusV2({
        code: "property_conflict",
        message: "stale",
        retryable: false,
      }),
    ).toBe(409);
    expect(
      blockPropertyMutationHttpStatusV2({
        code: "property_type_mismatch",
        message: "wrong type",
        retryable: false,
      }),
    ).toBe(400);

    const bound = bindTrustedBlockPropertyMutationV2(request, "project-1", {
      actor: { kind: "http_loopback" },
    });
    if (!bound.ok) throw new Error(bound.error.message);
    expect(
      blockPropertyMutationTransportFailureV2(
        bound.value,
        new Error("writer unavailable"),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "unknown",
        message: "writer unavailable",
        retryable: true,
        mutationId: "mutation-v2-1",
      },
    });
  });
});
