import { describe, expect, test } from "vitest";
import {
  decodeCardReferenceReadModelHttp,
  decodeCardSummaryHttp,
  decodeDatabaseViewReadModelHttp,
  ReferenceReadHttpBoundaryError,
} from "./reference-read-http-contract";
import { CARD_DOCUMENT_SCHEMA_VERSION } from "./block-documents";

const CREATED = "2026-01-01T01:02:03.004Z";
const DUE_DATE = "2026-01-02T05:06:07.008Z";
const SCHEDULED_START = "2026-01-03T09:10:11.012Z";
const SCHEDULED_END = "2026-01-03T13:14:15.016Z";

const makeCardSummaryWire = () => ({
  id: "card-1",
  status: "draft",
  archived: false,
  title: "HTTP Card",
  richTitle: [
    { type: "text", text: "HTTP ", styles: {} },
    { type: "text", text: "Card", styles: { bold: true } },
  ],
  tags: ["transport"],
  dueDate: DUE_DATE,
  scheduledStart: SCHEDULED_START,
  scheduledEnd: SCHEDULED_END,
  isAllDay: false,
  agentBlocked: false,
  created: CREATED,
  order: 4,
  descriptionPreview: "Preview",
  descriptionLength: 7,
  hasDescription: true,
});

const makeAvailableCardReferenceWire = () => ({
  status: "available",
  targetBlockId: "card-1",
  projectId: "target-project",
  lifecycle: "active",
  summary: makeCardSummaryWire(),
  document: {
    documentId: "document-1",
    generation: 1,
    headSeq: 9,
    readiness: "ready",
    authority: "ydoc_primary",
    schemaKey: "nodex.card",
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  },
});

const makeDatabaseViewWire = () => ({
  view: {
    id: "view-1",
    databaseBlockId: "database-1",
    projectId: "target-project",
    name: "Work",
    kind: "list",
    config: { includeArchived: false },
    isPrimary: false,
    createdAt: CREATED,
    updatedAt: DUE_DATE,
  },
  rows: [{
    card: makeCardSummaryWire(),
    groupKey: "draft",
    rankKey: "a0",
  }],
});

describe("reference read HTTP contract", () => {
  test("revives every Card summary timestamp as a Date", () => {
    const summary = decodeCardSummaryHttp(makeCardSummaryWire());

    expect(summary.created instanceof Date).toBe(true);
    expect(summary.richTitle?.[1]).toEqual({
      type: "text",
      text: "Card",
      styles: { bold: true },
    });
    expect(summary.dueDate instanceof Date).toBe(true);
    expect(summary.scheduledStart instanceof Date).toBe(true);
    expect(summary.scheduledEnd instanceof Date).toBe(true);
    expect(summary.created.toISOString()).toBe(CREATED);
    expect(summary.dueDate?.toISOString()).toBe(DUE_DATE);
    expect(summary.scheduledStart?.toISOString()).toBe(SCHEDULED_START);
    expect(summary.scheduledEnd?.toISOString()).toBe(SCHEDULED_END);
  });

  test("uses the same Card summary decoder for Card and Database View reads", () => {
    const cardReference = decodeCardReferenceReadModelHttp(
      makeAvailableCardReferenceWire(),
    );
    const databaseView = decodeDatabaseViewReadModelHttp(
      makeDatabaseViewWire(),
    );

    expect(cardReference.status).toBe("available");
    if (cardReference.status !== "available") return;
    expect(cardReference.summary.created instanceof Date).toBe(true);
    expect(databaseView.rows[0]?.card.created instanceof Date).toBe(true);
    expect(databaseView.rows[0]?.card.scheduledEnd?.toISOString()).toBe(
      SCHEDULED_END,
    );
  });

  for (const field of [
    "created",
    "dueDate",
    "scheduledStart",
    "scheduledEnd",
  ] as const) {
    test(`rejects an invalid ${field} timestamp with a boundary error`, () => {
      const wire = makeCardSummaryWire();
      wire[field] = "2026-02-30T00:00:00.000Z";
      let caught: unknown;

      try {
        decodeCardSummaryHttp(wire);
      } catch (error) {
        caught = error;
      }

      expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
      if (!(caught instanceof ReferenceReadHttpBoundaryError)) return;
      expect(caught.code).toBe("invalid_reference_http_payload");
      expect(caught.message.includes(`$.${field}`)).toBe(true);
    });
  }

  test("rejects malformed nested Card summaries at the reference boundary", () => {
    const wire = makeDatabaseViewWire();
    wire.rows[0]!.card.created = "not-a-date";
    let caught: unknown;

    try {
      decodeDatabaseViewReadModelHttp(wire);
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
    if (!(caught instanceof ReferenceReadHttpBoundaryError)) return;
    expect(caught.message.includes("$.rows[0].card.created")).toBe(true);
  });
});
