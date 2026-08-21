import { describe, expect, test } from "vitest";
import {
  canonicalizeBlockPropertyMutationRequest,
  makeBlockPropertyFieldPath,
  parseBlockPropertyMutationCommandResult,
  parseBlockPropertyMutationRequest,
  parseBlockPropertyMutationResult,
} from "./block-property-mutations";

const operationFails = (operation: () => void): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

const baseRequest = {
  mutationId: "mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "session-1",
  actor: { type: "agent", nested: { b: 2, a: 1 } },
};

describe("Block property mutation contract", () => {
  test("canonicalizes independent fields and set intent deterministically", () => {
    const left = {
      ...baseRequest,
      fields: [
        {
          scope: "database" as const,
          pageId: "card-1",
          databaseBlockId: "database-1",
          propertyId: "tags-1",
          operation: "add_remove" as const,
          add: ["zeta", "alpha", "alpha"],
          remove: ["old", "old"],
        },
        {
          scope: "intrinsic" as const,
          blockId: "card-1",
          propertyKey: "run.baseBranch",
          operation: "set" as const,
          expectedRevision: 4,
          value: { b: true, a: [1, 2] },
        },
      ],
    };
    const right = {
      ...baseRequest,
      actor: { nested: { a: 1, b: 2 }, type: "agent" },
      fields: [
        left.fields[1],
        {
          ...left.fields[0],
          add: ["alpha", "zeta"],
          remove: ["old"],
        },
      ],
    };

    const parsed = parseBlockPropertyMutationRequest(left);
    const setIntent = parsed.fields.find((field) => field.operation === "add_remove");
    expect(setIntent?.operation).toBe("add_remove");
    if (!setIntent || setIntent.operation !== "add_remove") {
      throw new Error("Expected a set intent");
    }
    expect(JSON.stringify(setIntent.add)).toBe(JSON.stringify(["alpha", "zeta"]));
    expect(JSON.stringify(setIntent.remove)).toBe(JSON.stringify(["old"]));
    expect(canonicalizeBlockPropertyMutationRequest(left)).toBe(
      canonicalizeBlockPropertyMutationRequest(right),
    );
    expect(parsed.fields.map(makeBlockPropertyFieldPath).join("|")).toBe(
      [...parsed.fields].map(makeBlockPropertyFieldPath).sort().join("|"),
    );
  });

  test("rejects unknown keys, duplicate paths, invalid JSON, and ambiguous set intent", () => {
    const intrinsic = {
      scope: "intrinsic" as const,
      blockId: "card-1",
      propertyKey: "run.baseBranch",
      operation: "set" as const,
      expectedRevision: 1,
      value: "running",
    };
    expect(
      operationFails(() =>
        parseBlockPropertyMutationRequest({
          ...baseRequest,
          unsupported: true,
          fields: [intrinsic],
        }),
      ),
    ).toBe(true);
    const withoutActor = Object.fromEntries(
      Object.entries(baseRequest).filter(([key]) => key !== "actor"),
    );
    expect(
      operationFails(() =>
        parseBlockPropertyMutationRequest({
          ...withoutActor,
          fields: [intrinsic],
        }),
      ),
    ).toBe(true);
    expect(
      operationFails(() =>
        parseBlockPropertyMutationRequest({
          ...baseRequest,
          fields: [intrinsic, intrinsic],
        }),
      ),
    ).toBe(true);
    expect(
      operationFails(() =>
        parseBlockPropertyMutationRequest({
          ...baseRequest,
          fields: [{ ...intrinsic, value: Number.NaN }],
        }),
      ),
    ).toBe(true);
    expect(
      operationFails(() =>
        parseBlockPropertyMutationRequest({
          ...baseRequest,
          fields: [
            {
              scope: "database",
              pageId: "card-1",
              databaseBlockId: "database-1",
              propertyId: "tags-1",
              operation: "add_remove",
              add: ["same"],
              remove: ["same"],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("strictly validates committed receipts", () => {
    const result = parseBlockPropertyMutationResult({
      mutationId: "mutation-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
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
      blockMetadataRevisions: { "card-1": 3 },
      commitSeq: 5,
      committedAt: "2026-07-11T00:00:00.000Z",
    });
    expect(result.fields[0]?.revision).toBe(2);
    expect(result.blockMetadataRevisions["card-1"]).toBe(3);
    expect(parseBlockPropertyMutationCommandResult({ ok: true, value: result }).ok).toBe(true);
    expect(operationFails(() => parseBlockPropertyMutationResult({ ...result, extra: true }))).toBe(
      true,
    );
  });

  test("preserves JSON keys that would otherwise mutate object prototypes", () => {
    const actor = JSON.parse('{"__proto__":{"kind":"agent"}}') as unknown;
    const parsed = parseBlockPropertyMutationRequest({
      ...baseRequest,
      actor,
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
    });
    expect(Object.hasOwn(parsed.actor, "__proto__")).toBe(true);
    expect(canonicalizeBlockPropertyMutationRequest(parsed).includes("__proto__")).toBe(true);
  });
});
