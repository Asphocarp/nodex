import { describe, expect, test } from "vitest";
import {
  decodePageTargetReadModelHttp,
  decodePageSummaryHttp,
  decodeDatabaseViewReadModelHttp,
  ReferenceReadHttpBoundaryError,
} from "./reference-read-http-contract";
import { PAGE_DOCUMENT_SCHEMA_VERSION } from "./block-documents";

const CREATED = "2026-01-01T01:02:03.004Z";
const DUE_DATE = "2026-01-02T05:06:07.008Z";
const SCHEDULED_START = "2026-01-03T09:10:11.012Z";
const SCHEDULED_END = "2026-01-03T13:14:15.016Z";

const makePageSummaryWire = () => ({
  id: "card-1",
  status: "draft",
  archived: false,
  title: "HTTP Page",
  richTitle: [
    { type: "text", text: "HTTP ", styles: {} },
    { type: "text", text: "Page", styles: { bold: true } },
  ],
  tags: ["transport"],
  dueDate: DUE_DATE,
  scheduledStart: SCHEDULED_START,
  scheduledEnd: SCHEDULED_END,
  isAllDay: false,
  created: CREATED,
  order: 4,
  descriptionPreview: "Preview",
  descriptionLength: 7,
  hasDescription: true,
});

const makeAvailablePageTargetWire = () => ({
  status: "available",
  targetPageId: "card-1",
  page: {
    pageId: "card-1",
    libraryId: "library:target",
    lifecycle: "active",
    parent: { kind: "page", pageId: "page:host" },
    parentRevision: 2,
    metadataRevision: 3,
    documentId: "document-1",
    documentGeneration: 1,
    documentHeadSeq: 9,
    title: "HTTP Page",
    richTitle: makePageSummaryWire().richTitle,
    preview: "Preview",
    plainText: "Body",
    createdAt: CREATED,
    updatedAt: DUE_DATE,
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.page",
    schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
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
    page: makePageSummaryWire(),
    groupKey: "draft",
    rankKey: "a0",
  }],
});

describe("reference read HTTP contract", () => {
  test("revives every Page summary timestamp as a Date", () => {
    const summary = decodePageSummaryHttp(makePageSummaryWire());

    expect(summary.created instanceof Date).toBe(true);
    expect(summary.richTitle?.[1]).toEqual({
      type: "text",
      text: "Page",
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

  test("strips retired and unknown Page summary fields", () => {
    const summary = decodePageSummaryHttp({
      ...makePageSummaryWire(),
      agentBlocked: true,
      agentStatus: "legacy",
      unknownExtension: "legacy",
    });

    expect("agentBlocked" in summary).toBe(false);
    expect("agentStatus" in summary).toBe(false);
    expect("unknownExtension" in summary).toBe(false);
  });

  test("keeps Page target content independent from Database row summaries", () => {
    const pageTarget = decodePageTargetReadModelHttp(
      makeAvailablePageTargetWire(),
    );
    const databaseView = decodeDatabaseViewReadModelHttp(
      makeDatabaseViewWire(),
    );

    expect(pageTarget.status).toBe("available");
    if (pageTarget.status !== "available") return;
    expect(pageTarget.page.parent).toEqual({
      kind: "page",
      pageId: "page:host",
    });
    expect(pageTarget.page.richTitle[1]).toEqual({
      type: "text",
      text: "Page",
      styles: { bold: true },
    });
    expect(pageTarget.page.createdAt).toBe(CREATED);
    expect(databaseView.rows[0]?.page.created instanceof Date).toBe(true);
    expect(databaseView.rows[0]?.page.scheduledEnd?.toISOString()).toBe(
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
      const wire = makePageSummaryWire();
      wire[field] = "2026-02-30T00:00:00.000Z";
      let caught: unknown;

      try {
        decodePageSummaryHttp(wire);
      } catch (error) {
        caught = error;
      }

      expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
      if (!(caught instanceof ReferenceReadHttpBoundaryError)) return;
      expect(caught.code).toBe("invalid_reference_http_payload");
      expect(caught.message.includes(`$.${field}`)).toBe(true);
    });
  }

  test("rejects malformed nested Page summaries at the reference boundary", () => {
    const wire = makeDatabaseViewWire();
    wire.rows[0]!.page.created = "not-a-date";
    let caught: unknown;

    try {
      decodeDatabaseViewReadModelHttp(wire);
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
    if (!(caught instanceof ReferenceReadHttpBoundaryError)) return;
    expect(caught.message.includes("$.rows[0].page.created")).toBe(true);
  });
});
