import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { primaryCanvasBlockId } from "../../shared/block-documents";
import {
  getOwnedDocumentAccess,
  getOwnedBlockDocumentDescriptor,
  getOwnedDocumentDescriptor,
} from "./block-document-cutover";
import { authorizeDocumentAccessInDatabase } from "./document-access";
import { createPage } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { putProjectResourceGrant } from "./project-resource-grants";

const supportsBetterSqlite3 = (): boolean => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("better-sqlite3") &&
      message.includes("not yet supported")
    ) {
      return false;
    }
    throw error;
  }
};

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;

describe("owned Document descriptor lookup", () => {
  sqliteTest("dispatches Card and Canvas owners by registered sync engine", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-owned-document-descriptor-"),
    );
    process.env.NODEX_HOME = tempDir;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Owned descriptor engines" });
      const card = await createPage(project.id, "triage", {
        title: "Yjs Card",
      });
      const database = getDb();

      const cardDescriptor = getOwnedDocumentDescriptor(
        database,
        project.id,
        card.id,
      );
      expect(cardDescriptor.sync.kind).toBe("yjs");
      if (cardDescriptor.sync.kind !== "yjs") {
        throw new Error("Expected a Yjs Card descriptor");
      }
      expect(cardDescriptor.sync.stateVector.byteLength).toBeGreaterThan(0);

      const canvasDescriptor = getOwnedDocumentDescriptor(
        database,
        project.id,
        primaryCanvasBlockId(project.id),
      );
      expect(canvasDescriptor.sync).toEqual({ kind: "canvas_scene" });
      expect("stateVector" in canvasDescriptor.sync).toBe(false);

      const legacyCanvasDescriptor = getOwnedBlockDocumentDescriptor(
        database,
        project.id,
        primaryCanvasBlockId(project.id),
      );
      expect(legacyCanvasDescriptor.authority).toBe("ydoc_primary");
      expect(legacyCanvasDescriptor.stateVector.byteLength).toBe(0);
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_HOME;
    }
  });

  sqliteTest("uses the requesting Project as Page access context", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-owned-page-access-"),
    );
    process.env.NODEX_HOME = tempDir;
    try {
      await initializeDatabase();
      const requester = createProject({ name: "Requester" });
      const owner = createProject({ name: "Owner" });
      const page = await createPage(owner.id, "triage", {
        title: "Shared Page",
      });
      const database = getDb();

      expect(() =>
        getOwnedDocumentDescriptor(database, requester.id, page.id)
      ).toThrow("not available in the requesting Project");

      putProjectResourceGrant({
        projectId: requester.id,
        root: { kind: "page", pageId: page.id },
        access: "read",
      });
      const descriptor = getOwnedDocumentDescriptor(
        database,
        requester.id,
        page.id,
      );
      expect(descriptor).toMatchObject({
        projectId: requester.id,
        ownerBlockId: page.id,
      });
      expect(
        authorizeDocumentAccessInDatabase(database, {
          projectId: requester.id,
          documentId: descriptor.documentId,
          access: "read",
        }).ok,
      ).toBe(true);
      expect(
        authorizeDocumentAccessInDatabase(database, {
          projectId: requester.id,
          documentId: descriptor.documentId,
          access: "write",
        }),
      ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
      expect(() =>
        getOwnedDocumentAccess(database, requester.id, page.id, "write")
      ).toThrow("not available in the requesting Project");

      putProjectResourceGrant({
        projectId: requester.id,
        root: { kind: "page", pageId: page.id },
        access: "read_write",
      });
      const writable = getOwnedDocumentAccess(
        database,
        requester.id,
        page.id,
        "write",
      );
      expect(writable.requestingProjectId).toBe(requester.id);
      expect(writable.storageProjectId).toBe(owner.id);
      expect(
        authorizeDocumentAccessInDatabase(database, {
          projectId: requester.id,
          documentId: descriptor.documentId,
          access: "write",
        }).ok,
      ).toBe(true);
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_HOME;
    }
  });
});
