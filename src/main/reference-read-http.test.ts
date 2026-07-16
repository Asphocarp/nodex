import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type { Page } from "../shared/page";
import type { DatabasePageSummary } from "../shared/types";
import { registerReferenceReadHttpRoutes } from "./reference-read-http";

const summary = (id: string, title: string): DatabasePageSummary => ({
  id,
  status: "draft",
  archived: false,
  title,
  richTitle: [{ type: "text", text: title, styles: {} }],
  tags: [],
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

const pageTarget = (
  id: string,
  title: string,
): Page & { readonly lifecycle: "active" } => ({
  pageId: id,
  libraryId: "library:target",
  lifecycle: "active",
  parent: { kind: "library", libraryId: "library:target" },
  parentRevision: 1,
  metadataRevision: 1,
  documentId: `document:${id}`,
  documentGeneration: 1,
  documentHeadSeq: 7,
  title,
  richTitle: [{ type: "text", text: title, styles: {} }],
  preview: "",
  plainText: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("canonical reference HTTP reads", () => {
  test("keeps the host scope separate from a granted cross-Project Page target", async () => {
    const app = new Hono();
    let capturedScope = "";
    registerReferenceReadHttpRoutes(app, {
      resolvePageTarget: (input) => {
        capturedScope = input.requestingProjectId;
        return {
          status: "available",
          targetPageId: input.targetPageId,
          page: pageTarget(input.targetPageId, "Cross-project Page"),
          document: {
            readiness: "ready",
            schemaKey: "nodex.page",
            schemaVersion: 2,
          },
        };
      },
      readDatabaseViewReference: () => null,
    });

    const response = await app.request(
      "/api/projects/host-project/page-targets/page%3Atarget",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as {
      page?: { libraryId?: string };
      targetPageId?: string;
    };
    expect(capturedScope).toBe("host-project");
    expect(body.page?.libraryId).toBe("library:target");
    expect(body.targetPageId).toBe("page:target");
  });

  test("returns durable Database View rows in authority order", async () => {
    const app = new Hono();
    let capturedHostBlockId = "";
    registerReferenceReadHttpRoutes(app, {
      resolvePageTarget: () => null,
      readDatabaseViewReference: (input) => {
        capturedHostBlockId = input.hostBlockId ?? "";
        return {
          view: {
            id: input.databaseViewId,
            databaseBlockId: "database:source:primary",
            projectId: "source-project",
            name: "Project work",
            kind: "list",
            config: {},
            isPrimary: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          rows: [
            { page: summary("card-b", "Second"), groupKey: "draft", rankKey: "a" },
            { page: summary("card-a", "First"), groupKey: "draft", rankKey: "b" },
          ],
        };
      },
    });

    const response = await app.request(
      "/api/projects/host-project/references/database-views/database-view%3Ainline%3Ablock-1?hostBlockId=page%3Ahost",
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      view?: { projectId?: string };
      rows?: Array<{ page?: { id?: string }; rankKey?: string }>;
    };
    expect(body.view?.projectId).toBe("source-project");
    expect(capturedHostBlockId).toBe("page:host");
    expect(body.rows?.map((row) => row.page?.id).join(",")).toBe("card-b,card-a");
    expect(body.rows?.map((row) => row.rankKey).join(",")).toBe("a,b");
  });

  test("rejects invalid identities and maps absent scopes or Views to 404", async () => {
    const app = new Hono();
    registerReferenceReadHttpRoutes(app, {
      resolvePageTarget: () => null,
      readDatabaseViewReference: () => null,
    });

    const invalid = await app.request(
      "/api/projects/host-project/page-targets/%20card%20",
    );
    expect(invalid.status).toBe(400);
    const absentCardScope = await app.request(
      "/api/projects/missing/page-targets/card-1",
    );
    expect(absentCardScope.status).toBe(404);
    const absentView = await app.request(
      "/api/projects/host-project/references/database-views/missing-view",
    );
    expect(absentView.status).toBe(404);
  });
});
