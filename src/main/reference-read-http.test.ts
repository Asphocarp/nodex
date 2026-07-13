import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type { CardSummary } from "../shared/types";
import { registerReferenceReadHttpRoutes } from "./reference-read-http";

const summary = (id: string, title: string): CardSummary => ({
  id,
  status: "draft",
  archived: false,
  title,
  richTitle: [{ type: "text", text: title, styles: {} }],
  tags: [],
  agentBlocked: false,
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

describe("canonical reference HTTP reads", () => {
  test("keeps the host scope separate from a cross-Project Card target", async () => {
    const app = new Hono();
    let capturedScope = "";
    registerReferenceReadHttpRoutes(app, {
      resolveCardReference: (input) => {
        capturedScope = input.requestingProjectId;
        return {
          status: "available",
          targetBlockId: input.targetBlockId,
          projectId: "target-project",
          lifecycle: "active",
          summary: summary(input.targetBlockId, "Cross-project Card"),
          document: {
            documentId: `document:${input.targetBlockId}`,
            generation: 1,
            headSeq: 7,
            readiness: "ready",
            authority: "ydoc_primary",
            schemaKey: "nodex.card",
            schemaVersion: 2,
          },
        };
      },
      readDatabaseViewReference: () => null,
    });

    const response = await app.request(
      "/api/projects/host-project/references/cards/card%3Atarget",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as {
      projectId?: string;
      targetBlockId?: string;
    };
    expect(capturedScope).toBe("host-project");
    expect(body.projectId).toBe("target-project");
    expect(body.targetBlockId).toBe("card:target");
  });

  test("returns durable Database View rows in authority order", async () => {
    const app = new Hono();
    let capturedHostBlockId = "";
    registerReferenceReadHttpRoutes(app, {
      resolveCardReference: () => null,
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
            { card: summary("card-b", "Second"), groupKey: "draft", rankKey: "a" },
            { card: summary("card-a", "First"), groupKey: "draft", rankKey: "b" },
          ],
        };
      },
    });

    const response = await app.request(
      "/api/projects/host-project/references/database-views/database-view%3Ainline%3Ablock-1?hostBlockId=card%3Ahost",
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      view?: { projectId?: string };
      rows?: Array<{ card?: { id?: string }; rankKey?: string }>;
    };
    expect(body.view?.projectId).toBe("source-project");
    expect(capturedHostBlockId).toBe("card:host");
    expect(body.rows?.map((row) => row.card?.id).join(",")).toBe("card-b,card-a");
    expect(body.rows?.map((row) => row.rankKey).join(",")).toBe("a,b");
  });

  test("rejects invalid identities and maps absent scopes or Views to 404", async () => {
    const app = new Hono();
    registerReferenceReadHttpRoutes(app, {
      resolveCardReference: () => null,
      readDatabaseViewReference: () => null,
    });

    const invalid = await app.request(
      "/api/projects/host-project/references/cards/%20card%20",
    );
    expect(invalid.status).toBe(400);
    const absentCardScope = await app.request(
      "/api/projects/missing/references/cards/card-1",
    );
    expect(absentCardScope.status).toBe(404);
    const absentView = await app.request(
      "/api/projects/host-project/references/database-views/missing-view",
    );
    expect(absentView.status).toBe(404);
  });
});
