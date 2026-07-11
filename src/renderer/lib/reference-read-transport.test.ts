import { describe, expect, test } from "vitest";
import {
  readDatabaseViewReference,
  resolveCardReference,
} from "./api";
import { ReferenceReadHttpBoundaryError } from "../../shared/reference-read-http-contract";

const makeCardSummaryWire = (created = "2026-01-01T00:00:00.000Z") => ({
  id: "card-target",
  status: "draft",
  archived: false,
  title: "Target Card",
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

    const card = await resolveCardReference({
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
      "http://localhost:51283/api/projects/host%2Fproject/references/cards/card%2Ftarget",
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
      await resolveCardReference({
        requestingProjectId: "host-project",
        targetBlockId: "target",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Card reference lookup failed with status 400");
  });

  test("revives Card summary dates for both browser reference routes", async () => {
    const responses = [
      new Response(JSON.stringify({
        status: "available",
        targetBlockId: "card-target",
        projectId: "target-project",
        lifecycle: "active",
        summary: makeCardSummaryWire(),
        document: {
          documentId: "document-target",
          generation: 1,
          headSeq: 3,
          readiness: "ready",
          authority: "ydoc_primary",
          schemaKey: "nodex.card",
          schemaVersion: 1,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
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

    const card = await resolveCardReference({
      requestingProjectId: "host-project",
      targetBlockId: "card-target",
    });
    const view = await readDatabaseViewReference({
      requestingProjectId: "host-project",
      databaseViewId: "view-one",
    });

    expect(card?.status).toBe("available");
    if (!card || card.status !== "available") return;
    expect(card.summary.created instanceof Date).toBe(true);
    expect(card.summary.dueDate instanceof Date).toBe(true);
    expect(card.summary.scheduledStart instanceof Date).toBe(true);
    expect(card.summary.scheduledEnd instanceof Date).toBe(true);
    expect(view?.rows[0]?.card.created instanceof Date).toBe(true);
    expect(view?.rows[0]?.card.scheduledEnd instanceof Date).toBe(true);
  });

  test("rejects invalid browser reference JSON with a typed boundary error", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async () => new Response(JSON.stringify({
        status: "available",
        targetBlockId: "card-target",
        projectId: "target-project",
        lifecycle: "active",
        summary: makeCardSummaryWire("not-an-iso-date"),
        document: {
          documentId: "document-target",
          generation: 1,
          headSeq: 3,
          readiness: "ready",
          authority: "ydoc_primary",
          schemaKey: "nodex.card",
          schemaVersion: 1,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    let caught: unknown;

    try {
      await resolveCardReference({
        requestingProjectId: "host-project",
        targetBlockId: "card-target",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ReferenceReadHttpBoundaryError).toBe(true);
  });
});
