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

const baseRequest = {
  version: 2 as const,
  mutationId: "mutation-v2",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "session-1",
  actor: { type: "agent", nested: { b: 2, a: 1 } },
};

const tagField = {
  scope: "data_source" as const,
  pageId: "page / one",
  dataSourceId: "source / one",
  propertyId: "p_AAAAAAAA",
  operation: "add_remove" as const,
  add: ["o_BBBBBBBB", "o_AAAAAAAA", "o_AAAAAAAA"],
  remove: ["o_CCCCCCCC", "o_CCCCCCCC"],
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

  test("canonicalizes Source-scoped fields and option sets deterministically", () => {
    const left = {
      ...baseRequest,
      fields: [tagField, intrinsicField],
    };
    const right = {
      ...baseRequest,
      actor: { nested: { a: 1, b: 2 }, type: "agent" },
      fields: [
        intrinsicField,
        {
          ...tagField,
          add: ["o_AAAAAAAA", "o_BBBBBBBB"],
          remove: ["o_CCCCCCCC"],
        },
      ],
    };

    const parsed = parseBlockPropertyMutationRequestV2(left);
    const dataSourceField = parsed.fields.find(
      (field) => field.scope === "data_source",
    );
    expect(dataSourceField?.scope).toBe("data_source");
    if (!dataSourceField || dataSourceField.scope !== "data_source") {
      throw new Error("Expected a Data Source field");
    }
    expect(makeBlockPropertyFieldPathV2(dataSourceField)).toBe(
      "data_source/source%20%2F%20one/page%20%2F%20one/p_AAAAAAAA",
    );
    if (dataSourceField.operation !== "add_remove") {
      throw new Error("Expected an add_remove field");
    }
    expect(dataSourceField.add).toEqual(["o_AAAAAAAA", "o_BBBBBBBB"]);
    expect(dataSourceField.remove).toEqual(["o_CCCCCCCC"]);
    expect(canonicalizeBlockPropertyMutationRequestV2(left)).toBe(
      canonicalizeBlockPropertyMutationRequestV2(right),
    );
    expect(parsed.fields.map(makeBlockPropertyFieldPathV2)).toEqual(
      [...parsed.fields].map(makeBlockPropertyFieldPathV2).sort(),
    );
  });

  test("accepts reserved Property IDs while rejecting v1 coordinates and invalid compact IDs", () => {
    expect(
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [
          {
            scope: "data_source",
            pageId: "page-1",
            dataSourceId: "source-1",
            propertyId: "status",
            operation: "set",
            expectedRevision: 1,
            value: "triage",
          },
        ],
      }).fields[0],
    ).toMatchObject({ propertyId: "status", dataSourceId: "source-1" });

    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [{ ...tagField, scope: "database", databaseBlockId: "db-1" }],
      }),
    ).toThrow(BlockPropertyMutationV2ContractError);
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [
          {
            ...tagField,
            propertyId: "database:project:primary:property:tags",
          },
        ],
      }),
    ).toThrow(/compact or reserved/u);
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [{ ...tagField, add: ["not-an-option"] }],
      }),
    ).toThrow(/valid option ID/u);
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [
          {
            ...tagField,
            unsupported: true,
          },
        ],
      }),
    ).toThrow(/not supported/u);
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [
          {
            scope: "data_source",
            pageId: "page-1",
            dataSourceId: "source-1",
            propertyId: "status",
            operation: "set",
            expectedRevision: 1,
            value: "not-a-workflow-status",
          },
        ],
      }),
    ).toThrow(/valid option ID/u);
  });

  test("rejects duplicate paths and ambiguous option set intent", () => {
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [intrinsicField, intrinsicField],
      }),
    ).toThrow(/duplicate property path/u);
    expect(() =>
      parseBlockPropertyMutationRequestV2({
        ...baseRequest,
        fields: [
          {
            ...tagField,
            add: ["o_AAAAAAAA"],
            remove: ["o_AAAAAAAA"],
          },
        ],
      }),
    ).toThrow(/same option/u);
  });

  test("strictly validates Source-scoped committed results", () => {
    const value = {
      version: 2,
      mutationId: "mutation-v2",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      duplicate: false,
      fields: [
        {
          path: "data_source/source-1/page-1/p_AAAAAAAA",
          scope: "data_source",
          blockId: "page-1",
          dataSourceId: "source-1",
          propertyId: "p_AAAAAAAA",
          operation: "add_remove",
          revision: 2,
          value: ["o_AAAAAAAA", "o_BBBBBBBB"],
        },
      ],
      blockMetadataRevisions: { "page-1": 3 },
      changeLogSeq: 5,
      committedAt: "2026-07-18T00:00:00.000Z",
    };

    const parsed = parseBlockPropertyMutationResultV2(value);
    expect(parsed.fields[0]).toMatchObject({
      scope: "data_source",
      dataSourceId: "source-1",
      propertyId: "p_AAAAAAAA",
    });
    expect(
      parseBlockPropertyMutationCommandResultV2({ ok: true, value }),
    ).toEqual({ ok: true, value: parsed });

    expect(() =>
      parseBlockPropertyMutationResultV2({
        ...value,
        fields: [{ ...value.fields[0], dataSourceId: undefined }],
      }),
    ).toThrow(/dataSourceId/u);
    expect(() =>
      parseBlockPropertyMutationResultV2({
        ...value,
        fields: [{ ...value.fields[0], path: "data_source/wrong/page-1/p_AAAAAAAA" }],
      }),
    ).toThrow(/path does not match/u);
    expect(() =>
      parseBlockPropertyMutationResultV2({
        ...value,
        fields: [
          {
            ...value.fields[0],
            value: ["o_BBBBBBBB", "o_AAAAAAAA"],
          },
        ],
      }),
    ).toThrow(/sorted unique/u);
  });

  test("strictly parses v2 errors and requires complete conflict evidence", () => {
    const conflict = {
      code: "property_conflict",
      message: "Property changed",
      retryable: false,
      mutationId: "mutation-v2",
      fieldPath: "data_source/source-1/page-1/p_AAAAAAAA",
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
