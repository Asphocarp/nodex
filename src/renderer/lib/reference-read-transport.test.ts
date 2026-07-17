import { describe, expect, test } from "vitest";
import {
  readDatabaseViewReference,
  resolvePageOwnershipPath,
  resolvePageTarget,
} from "./api";
import { ReferenceReadHttpBoundaryError } from "../../shared/reference-read-http-contract";
import { PAGE_DOCUMENT_SCHEMA_VERSION } from "../../shared/block-documents";

const makeCardSummaryWire = (created = "2026-01-01T00:00:00.000Z") => ({
  id: "card-target",
  status: "draft",
  archived: false,
  title: "Target Page",
  richTitle: [
    { type: "text", text: "Target ", styles: {} },
    { type: "text", text: "Page", styles: { bold: true } },
  ],
  tags: [],
  dueDate: "2026-01-02T00:00:00.000Z",
  scheduledStart: "2026-01-03T09:00:00.000Z",
  scheduledEnd: "2026-01-03T10:00:00.000Z",
  created,
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

const makePageTargetWire = (updatedAt = "2026-01-02T00:00:00.000Z") => ({
  status: "available",
  targetPageId: "card-target",
  page: {
    pageId: "card-target",
    libraryId: "library:target",
    lifecycle: "active",
    parent: { kind: "page", pageId: "page:host" },
    parentRevision: 1,
    metadataRevision: 1,
    documentId: "document-target",
    documentGeneration: 1,
    documentHeadSeq: 3,
    title: "Target Page",
    richTitle: makeCardSummaryWire().richTitle,
    preview: "",
    plainText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.page",
    schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
  },
});

describe("reference read renderer transport", () => {
  test("maps canonical reference reads to encoded browser HTTP routes", async () => {
    const requestedUrls: string[] = [];
    const responses = [
      new Response(JSON.stringify({
        status: "missing",
        targetPageId: "card/target",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({
        status: "available",
        targetPageId: "card/target",
        ancestors: [{
          pageId: "page/root",
          title: "Root",
          lifecycle: "active",
        }],
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

    const card = await resolvePageTarget({
      requestingProjectId: "host/project",
      targetPageId: "card/target",
    });
    expect(card?.status).toBe("missing");
    const ownershipPath = await resolvePageOwnershipPath({
      requestingProjectId: "host/project",
      targetPageId: "card/target",
    });
    expect(ownershipPath?.status).toBe("available");
    if (ownershipPath?.status !== "available") {
      throw new Error("Expected an available Page ownership path");
    }
    expect(ownershipPath.ancestors.map((ancestor) => ancestor.title)).toEqual(["Root"]);
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
      "http://localhost:51283/api/projects/host%2Fproject/page-targets/card%2Ftarget",
    );
    expect(requestedUrls[1]).toBe(
      "http://localhost:51283/api/projects/host%2Fproject/page-targets/card%2Ftarget/ownership-path",
    );
    expect(requestedUrls[2]).toBe(
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
      await resolvePageTarget({
        requestingProjectId: "host-project",
        targetPageId: "target",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Page target lookup failed with status 400");
  });

  test("decodes membership-free Page targets separately from Database rows", async () => {
    const responses = [
      new Response(JSON.stringify(makePageTargetWire()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      new Response(JSON.stringify({
        view: {
          id: "view-one",
          databaseBlockId: "database-target",
          projectId: "source-project",
          name: "Work",
          kind: "list",
          config: {},
          isPrimary: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        rows: [{
          page: makeCardSummaryWire(),
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

    const card = await resolvePageTarget({
      requestingProjectId: "host-project",
      targetPageId: "card-target",
    });
    const view = await readDatabaseViewReference({
      requestingProjectId: "host-project",
      databaseViewId: "view-one",
    });

    expect(card?.status).toBe("available");
    if (!card || card.status !== "available") return;
    expect(card.page.parent).toEqual({
      kind: "page",
      pageId: "page:host",
    });
    expect(card.page.title).toBe("Target Page");
    expect(card.page.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(view?.rows[0]?.page.created instanceof Date).toBe(true);
    expect(view?.rows[0]?.page.scheduledEnd instanceof Date).toBe(true);
  });

  test("rejects invalid browser reference JSON with a typed boundary error", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () => new Response(
        JSON.stringify(makePageTargetWire("not-an-iso-date")),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    let caught: unknown;

    try {
      await resolvePageTarget({
        requestingProjectId: "host-project",
        targetPageId: "card-target",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
  });
});
