import { describe, expect, test } from "vitest";

import {
  CARD_METADATA_INTRINSIC_FIELDS,
  type CardIntrinsicMetadataField,
  type CardMetadataPropertySnapshot,
} from "./card-metadata-property-compiler";
import {
  CardMetadataPropertySnapshotContractError,
  parseCardMetadataPropertySnapshot,
} from "./card-metadata-property-snapshot";
import {
  parseCardMetadataPropertySnapshotCommandResult,
} from "./card-metadata-property-snapshot-transport";

const completeSnapshot = (): CardMetadataPropertySnapshot => ({
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 12,
  cardBlockId: "card-1",
  metadataRevision: 8,
  fields: [
    ...(
      Object.keys(CARD_METADATA_INTRINSIC_FIELDS) as CardIntrinsicMetadataField[]
    ).map((field, index) => ({
      scope: "intrinsic" as const,
      field,
      revision: index,
      value: null,
    })),
    {
      scope: "database",
      field: "priority",
      databaseBlockId: "database-1",
      propertyId: "property-priority",
      revision: 4,
      value: "p1-high",
    },
  ],
});

const errorMessage = (operation: () => unknown): string => {
  try {
    operation();
    return "";
  } catch (error) {
    return error instanceof CardMetadataPropertySnapshotContractError
      ? error.message
      : "unexpected";
  }
};

describe("Card metadata property snapshot contract", () => {
  test("round-trips a complete authority coordinate from JSON", () => {
    const parsed = parseCardMetadataPropertySnapshot(
      JSON.parse(JSON.stringify(completeSnapshot())),
    );

    expect(parsed.projectId).toBe("project-1");
    expect(parsed.fields.length).toBe(12);
    expect(parsed.fields.at(-1)?.field).toBe("priority");
  });

  test("rejects duplicate fields, missing intrinsic coordinates, and extra keys", () => {
    const complete = completeSnapshot();
    expect(
      errorMessage(() =>
        parseCardMetadataPropertySnapshot({
          ...complete,
          fields: [...complete.fields, complete.fields[0]],
        }),
      ),
    ).toBe(
      "cardMetadataPropertySnapshot.fields contains duplicate isAllDay",
    );
    expect(
      errorMessage(() =>
        parseCardMetadataPropertySnapshot({
          ...complete,
          fields: complete.fields.filter((field) => field.field !== "recurrence"),
        }),
      ),
    ).toBe(
      "cardMetadataPropertySnapshot.fields is missing intrinsic field recurrence",
    );
    expect(
      errorMessage(() =>
        parseCardMetadataPropertySnapshot({ ...complete, leaked: true }),
      ),
    ).toBe("cardMetadataPropertySnapshot.leaked is not supported");
  });

  test("parses exact success and typed failure envelopes", () => {
    const success = parseCardMetadataPropertySnapshotCommandResult({
      ok: true,
      value: completeSnapshot(),
    });
    expect(success.ok).toBe(true);

    const failure = parseCardMetadataPropertySnapshotCommandResult({
      ok: false,
      error: {
        code: "card_not_found",
        message: "missing",
        retryable: false,
      },
    });
    expect(failure.ok).toBe(false);
    expect(failure.ok ? "ok" : failure.error.code).toBe("card_not_found");
    expect(
      errorMessage(() =>
        parseCardMetadataPropertySnapshotCommandResult({
          ok: false,
          error: {
            code: "card_not_found",
            message: "missing",
            retryable: false,
            detail: "leak",
          },
        }),
      ),
    ).toBe("cardMetadataPropertySnapshotResult.error is malformed");
  });
});
