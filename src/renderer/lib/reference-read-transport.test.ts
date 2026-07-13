import { describe, expect, test } from "vitest";
import {
  readDatabaseViewReference,
  resolveCardTarget,
} from "./api";
import { ReferenceReadHttpBoundaryError } from "../../shared/reference-read-http-contract";
import { CARD_DOCUMENT_SCHEMA_VERSION } from "../../shared/block-documents";

const makeCardSummaryWire = (created = "2026-01-01T00:00:00.000Z") => ({
  id: "card-target",
  status: "draft",
  archived: false,
  title: "Target Card",
  richTitle: [
    { type: "text", text: "Target ", styles: {} },
    { type: "text", text: "Card", styles: { bold: true } },
  ],
  tags: [],
  dueDate: "2026-01-02T00:00:00.000Z",
  scheduledStart: "2026-01-03T09:00:00.000Z",
  scheduledEnd: "2026-01-03T10:00:00.000Z",
  agentBlocked: false,
  created,
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

const makeCardTargetWire = (updatedAt = "2026-01-02T00:00:00.000Z") => ({
  status: "available",
  targetBlockId: "card-target",
  card: {
    blockId: "card-target",
    projectId: "target-project",
    lifecycle: "active",
    location: { kind: "document", documentId: "document-host" },
    locationRevision: 1,
    metadataRevision: 1,
    documentId: "document-target",
    documentGeneration: 1,
    documentHeadSeq: 3,
    documentAuthority: "ydoc_primary",
    content: {
      projectedSeq: 3,
      title: "Target Card",
      richTitle: makeCardSummaryWire().richTitle,
      preview: "",
      plainText: "",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.card",
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  },
});

describe("reference read renderer transport", () => {
  test("maps canonical reference reads to encoded browser HTTP routes", async () => {
    const requestedUrls: string[] = [];
    const responses = [
      new Response(JSON.stringify({
        status: "missing",
        targetBlockId: "card/target",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({
        view: {
          id: "view/one",
          databaseBlockId: "database:source:primary",
          projectId: "source-project",
          name: "Work",
          kind: "list",
          config: {},
          isPrimary: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        rows: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({ error: "Database View not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (input: string | URL | Request) => {
        requestedUrls.push(String(input));
        const response = responses.shift();
        if (!response) throw new Error("Unexpected reference read request");
        return response;
      },
    });

    const card = await resolveCardTarget({
      requestingProjectId: "host/project",
      targetBlockId: "card/target",
    });
    expect(card?.status).toBe("missing");
    const view = await readDatabaseViewReference({
      requestingProjectId: "host/project",
      databaseViewId: "view/one",
      hostBlockId: "host/card",
    });
    expect(view?.view.projectId).toBe("source-project");
    const absent = await readDatabaseViewReference({
      requestingProjectId: "host/project",
      databaseViewId: "missing",
    });
    expect(absent === null).toBe(true);
    expect(requestedUrls[0]).toBe(
      "http://localhost:51283/api/projects/host%2Fproject/card-targets/card%2Ftarget",
    );
    expect(requestedUrls[1]).toBe(
      "http://localhost:51283/api/projects/host%2Fproject/references/database-views/view%2Fone?hostBlockId=host%2Fcard",
    );
  });

  test("surfaces non-not-found HTTP failures instead of inventing empty data", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () => new Response("bad request", { status: 400 }),
    });
    let message = "";
    try {
      await resolveCardTarget({
        requestingProjectId: "host-project",
        targetBlockId: "target",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Card target lookup failed with status 400");
  });

  test("decodes membership-free Card targets separately from Database rows", async () => {
    const responses = [
      new Response(JSON.stringify(makeCardTargetWire()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      new Response(JSON.stringify({
        view: {
          id: "view-one",
          databaseBlockId: "database-target",
          projectId: "target-project",
          name: "Work",
          kind: "list",
          config: {},
          isPrimary: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        rows: [{
          card: makeCardSummaryWire(),
          groupKey: "draft",
          rankKey: "a0",
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () => {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected reference read request");
        return response;
      },
    });

    const card = await resolveCardTarget({
      requestingProjectId: "host-project",
      targetBlockId: "card-target",
    });
    const view = await readDatabaseViewReference({
      requestingProjectId: "host-project",
      databaseViewId: "view-one",
    });

    expect(card?.status).toBe("available");
    if (!card || card.status !== "available") return;
    expect(card.card.location).toEqual({
      kind: "document",
      documentId: "document-host",
    });
    expect(card.card.content?.title).toBe("Target Card");
    expect(card.card.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(view?.rows[0]?.card.created instanceof Date).toBe(true);
    expect(view?.rows[0]?.card.scheduledEnd instanceof Date).toBe(true);
  });

  test("rejects invalid browser reference JSON with a typed boundary error", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () => new Response(
        JSON.stringify(makeCardTargetWire("not-an-iso-date")),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    let caught: unknown;

    try {
      await resolveCardTarget({
        requestingProjectId: "host-project",
        targetBlockId: "card-target",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
  });
});
