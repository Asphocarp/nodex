import { describe, expect, test } from "vitest";
import { BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION } from "./block-property-mutations";
import {
  BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
  BlockPropertyMutationV2ContractError,
  canonicalizeBlockPropertyMutationRequestV2,
  makeBlockPropertyFieldPathV2,
  parseBlockPropertyMutationCommandErrorV2,
  parseBlockPropertyMutationCommandResultV2,
  parseBlockPropertyMutationRequestV2,
  parseBlockPropertyMutationResultV2,
} from "./block-property-mutations-v2";
import { committedLocalCommit } from "./testing/local-commit";

const baseRequest = {
  version: 2 as const,
  mutationId: "mutation-v2",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "session-1",
  actor: { type: "agent", nested: { b: 2, a: 1 } },
};

const intrinsicField = {
  scope: "intrinsic" as const,
  blockId: "page / one",
  propertyKey: "run.baseBranch",
  operation: "set" as const,
  expectedRevision: 4,
  value: { b: true, a: [1, 2] },
};

describe("Block Property mutation v2 contract", () => {
  test("is additive and leaves the executable v1 version unchanged", () => {
    expect(BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION).toBe(1);
    expect(BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION).toBe(2);
  });

  test("canonicalizes intrinsic fields deterministically", () => {
    const secondField = {
      ...intrinsicField,
      propertyKey: "run.target",
      value: "cloud",
    };
    const left = {
      ...baseRequest,
      fields: [secondField, intrinsicField],
    };
    const right = {
      ...baseRequest,
      actor: { nested: { a: 1, b: 2 }, type: "agent" },
      fields: [intrinsicField, secondField],
    };

    const parsed = parseBlockPropertyMutationRequestV2(left);
    expect(makeBlockPropertyFieldPathV2(parsed.fields[0]!)).toMatch(/^intrinsic\//u);
    expect(canonicalizeBlockPropertyMutationRequestV2(left)).toBe(
      canonicalizeBlockPropertyMutationRequestV2(right),
    );
    expect(parsed.fields.map(makeBlockPropertyFieldPathV2)).toEqual(
      [...parsed.fields].map(makeBlockPropertyFieldPathV2).sort(),
    );
  });

  test("rejects retired Data Source and v1 coordinates", () => {
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [{
          scope: "data_source",
          pageId: "page-1",
          dataSourceId: "source-1",
          propertyId: "status",
          operation: "set",
          expectedRevision: 1,
          value: "triage",
        }],
      }),
    ).toThrow(BlockPropertyMutationV2ContractError);
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [{ ...intrinsicField, scope: "database", databaseBlockId: "db-1" }],
      }),
    ).toThrow(BlockPropertyMutationV2ContractError);
  });

  test("rejects duplicate paths", () => {
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [intrinsicField, intrinsicField],
      }),
    ).toThrow(/duplicate property path/u);
  });

  test("strictly validates intrinsic committed results", () => {
    const value = {
      version: 2,
      mutationId: "mutation-v2",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      duplicate: false,
      fields: [
        {
          path: "intrinsic/page-1/run.target",
          scope: "intrinsic",
          blockId: "page-1",
          propertyKey: "run.target",
          operation: "set",
          revision: 2,
          value: "cloud",
        },
      ],
      blockMetadataRevisions: { "page-1": 3 },
      commitSeq: 5,
      committedAt: "2026-07-18T00:00:00.000Z",
    };

    const parsed = parseBlockPropertyMutationResultV2(value);
    expect(parsed.fields[0]).toMatchObject({
      scope: "intrinsic",
      propertyKey: "run.target",
    });
    expect(
      parseBlockPropertyMutationCommandResultV2({
        ok: true,
        value,
        localCommit: committedLocalCommit("epoch-1", 5),
      }),
    ).toEqual({
      ok: true,
      value: parsed,
      localCommit: committedLocalCommit("epoch-1", 5),
    });

    expect(() =>
      parseBlockPropertyMutationResultV2({
        ...value,
        fields: [{ ...value.fields[0], propertyKey: undefined }],
      }),
    ).toThrow(/propertyKey/u);
    expect(() =>
      parseBlockPropertyMutationResultV2({
        ...value,
        fields: [{ ...value.fields[0], path: "intrinsic/wrong/run.target" }],
      }),
    ).toThrow(/path does not match/u);
  });

  test("strictly parses v2 errors and requires complete conflict evidence", () => {
    const conflict = {
      code: "property_conflict",
      message: "Property changed",
      retryable: false,
      mutationId: "mutation-v2",
      fieldPath: "intrinsic/page-1/run.target",
      expectedRevision: 1,
      actualRevision: 2,
    };
    expect(parseBlockPropertyMutationCommandErrorV2(conflict)).toEqual(conflict);
    expect(
      parseBlockPropertyMutationCommandResultV2({
        ok: false,
        error: conflict,
      }),
    ).toEqual({ ok: false, error: conflict });
    expect(() =>
      parseBlockPropertyMutationCommandErrorV2({
        ...conflict,
        actualRevision: undefined,
      }),
    ).toThrow(/both revisions/u);
    expect(() =>
      parseBlockPropertyMutationCommandErrorV2({
        code: "database_not_found",
        message: "Old coordinate",
        retryable: false,
      }),
    ).toThrow(/not supported/u);
  });
});
