import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import type {
  DocumentVersionSummary,
  PrepareDocumentVersionRestore,
} from "../shared/block-documents/document-history";
import type { DocumentMutationRequest } from "../shared/block-documents/document-operations";
import {
  registerDocumentHistoryHttpRoutes,
  type DocumentHistoryHttpDependencies,
} from "./document-history-http";

const summary: DocumentVersionSummary = {
  versionId: `document-version:${"a".repeat(64)}`,
  documentId: "document-1",
  projectId: "project-1",
  generation: 1,
  baseHeadSeq: 4,
  schemaKey: "nodex.card",
  schemaVersion: 1,
  cause: "manual",
  label: null,
  actor: {},
  revisionKind: "manual",
  sourceMutationId: null,
  sourceChangeSeq: null,
  pinned: true,
  checkpointHash: "b".repeat(64),
  checkpointMetadata: {
    format: "yjs_update_v1" as const,
    stateVectorHash: "c".repeat(64),
  },
  materializationHash: "d".repeat(64),
  byteLength: 42,
  materializationKind: "card",
  title: "Checkpoint",
  preview: "Body",
  blockCount: 1,
  createdAt: "2026-07-11T00:00:00.000Z",
};

const makeDependencies = (
  overrides: Partial<DocumentHistoryHttpDependencies> = {},
): DocumentHistoryHttpDependencies => ({
  createCheckpoint: async () => ({
    ok: true,
    value: { checkpoint: summary, duplicate: false },
  }),
  listVersions: async () => ({ ok: true, value: [summary] }),
  getVersion: async () => ({
    ok: true,
    value: {
      summary,
      materialization: {
        kind: "card",
        schemaVersion: 1,
        title: "Checkpoint",
        richTitle: [{ type: "text", text: "Checkpoint", styles: {} }],
        blockTree: [],
        nfm: "",
        plainText: "",
        preview: "",
        references: [],
        assetRefs: [],
      },
    },
  }),
  restoreVersion: async (request) => ({
    ok: true,
    value: {
      version: 1,
      mutationKind: "document_version_restore",
      mutationId: request.mutationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      documentId: request.documentId,
      generation: request.generation,
      baseHeadSeq: request.expectedHeadSeq,
      headSeq: request.expectedHeadSeq + 1,
      touchedBlockIds: [],
      createdBlockIds: [],
      deletedBlockIds: [],
      updatedBlockIds: [],
      movedBlockIds: [],
      writeFenceBlockIds: [],
      titleChanged: false,
      coordination: "write_fence",
      changeLogSeq: 9,
      committedAt: "2026-07-11T00:00:01.000Z",
      duplicate: false,
    },
  }),
  ...overrides,
});

describe("Document history HTTP", () => {
  test("binds checkpoint audit identity and preserves version pagination", async () => {
    let actorKind: unknown;
    let cursorVersion: string | undefined;
    const app = new Hono();
    registerDocumentHistoryHttpRoutes(
      app,
      makeDependencies({
        createCheckpoint: async (request) => {
          actorKind = request.actor.kind;
          return {
            ok: true,
            value: { checkpoint: summary, duplicate: false },
          };
        },
        listVersions: async (request) => {
          cursorVersion = request.before?.versionId;
          return { ok: true, value: [summary] };
        },
      }),
    );
    const checkpointResponse = await app.request(
      "/api/projects/project-1/documents/document-1/versions/checkpoints",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          projectId: "project-1",
          storeEpoch: "epoch-1",
          documentId: "document-1",
          expectedGeneration: 1,
          expectedHeadSeq: 4,
          cause: "manual",
          actor: { kind: "spoofed" },
        }),
      },
    );
    expect(checkpointResponse.status).toBe(200);
    expect(actorKind).toBe("http_loopback");

    const listResponse = await app.request(
      `/api/projects/project-1/documents/document-1/versions?limit=1&beforeHeadSeq=4&beforeCreatedAt=${encodeURIComponent(summary.createdAt)}&beforeVersionId=${encodeURIComponent(summary.versionId)}`,
    );
    expect(listResponse.status).toBe(200);
    expect(cursorVersion).toBe(summary.versionId);
  });

  test("binds restore identity and rejects a mismatched version path", async () => {
    const captured: DocumentMutationRequest[] = [];
    const app = new Hono();
    registerDocumentHistoryHttpRoutes(
      app,
      makeDependencies({
        restoreVersion: async (request) => {
          captured.push(request);
          return makeDependencies().restoreVersion(request);
        },
      }),
    );
    const request: PrepareDocumentVersionRestore = {
      version: 1,
      mutationId: "restore-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      documentId: "document-1",
      versionId: summary.versionId,
      generation: 1,
      expectedHeadSeq: 5,
      clientSessionId: "spoofed",
      actor: { kind: "spoofed" },
    };
    const response = await app.request(
      `/api/projects/project-1/documents/document-1/versions/${encodeURIComponent(summary.versionId)}/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    expect(response.status).toBe(200);
    expect(captured[0]?.clientSessionId).toBe("http-loopback:document-history");
    expect(captured[0]?.actor.kind).toBe("http_loopback");

    const mismatch = await app.request(
      "/api/projects/project-1/documents/document-1/versions/wrong/restore",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    expect(mismatch.status).toBe(400);
    expect(captured.length).toBe(1);
  });
});
