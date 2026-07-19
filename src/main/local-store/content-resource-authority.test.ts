import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { libraryContentAccess, projectContentAccess } from "../../shared/content-access-context";
import { requireBlockStoreEpoch } from "./block-store-metadata";
import {
  authorizeContentResourceInDatabase,
  resolveContentResourceAuthorityInDatabase,
} from "./content-resource-authority";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createPage } from "./database-pages";
import { createProject, setProjectLifecycle } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-content-authority-"));
  process.env.NODEX_HOME = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_HOME;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Content resource authority", () => {
  test("gives the local user Library-wide authority while preserving Project grants", async () => {
    const actor = createProject({ name: "Actor" });
    const foreign = createProject({ name: "Foreign" });
    const page = await createPage(foreign.id, "triage", { title: "Library Page" });
    setProjectLifecycle(foreign.id, { lifecycle: "archived" });
    const database = getDb();

    const libraryAuthority = resolveContentResourceAuthorityInDatabase(database, {
      context: libraryContentAccess,
      actor: "app_window",
    });
    expect(authorizeContentResourceInDatabase(database, {
      authority: libraryAuthority,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    })).toMatchObject({ allowed: true, authorityKind: "local_user_library" });

    const projectAuthority = resolveContentResourceAuthorityInDatabase(database, {
      context: projectContentAccess(actor.id),
      actor: "project_agent",
    });
    expect(authorizeContentResourceInDatabase(database, {
      authority: projectAuthority,
      resource: { kind: "page", pageId: page.id },
      action: "write",
    })).toMatchObject({
      authorityKind: "project",
      authorization: { allowed: false, reason: "grant_missing" },
    });
  });

  test("derives Library identity from the store and fences restored authorities", () => {
    const database = getDb();
    const authority = resolveContentResourceAuthorityInDatabase(database, {
      context: libraryContentAccess,
      actor: "http_loopback",
    });
    expect(authority).toMatchObject({
      kind: "local_user_library",
      storeEpoch: requireBlockStoreEpoch(database),
    });
    expect(() => resolveContentResourceAuthorityInDatabase(database, {
      context: libraryContentAccess,
      actor: "project_agent",
    })).toThrow("cannot claim local Library authority");

    database.prepare(
      "UPDATE block_store_metadata SET store_epoch = ? WHERE id = 1",
    ).run("restored-epoch");
    expect(authority.kind).toBe("local_user_library");
    if (authority.kind !== "local_user_library") return;
    expect(authorizeContentResourceInDatabase(database, {
      authority,
      resource: { kind: "page", pageId: "missing" },
      action: "read",
    })).toMatchObject({ allowed: false, reason: "authority_stale" });
  });
});
