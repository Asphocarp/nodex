import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createPage } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { readPageDetailInDatabase } from "./page-detail";
import { putProjectResourceGrant } from "./project-resource-grants";
import { createProject } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-page-detail-"));
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Page Detail", () => {
  test("reads one canonical Page with its Source schema and values", async () => {
    const project = createProject({ name: "Detail" });
    const created = await createPage(project.id, "in_progress", {
      title: "Library Page",
      priority: "p1-high",
    });

    const result = readPageDetailInDatabase(getDb(), project.id, created.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.page).toMatchObject({
      pageId: created.id,
      libraryId: project.libraryId,
      title: "Library Page",
      parent: { kind: "data_source" },
    });
    expect(result.value.document).toMatchObject({
      readiness: "ready",
      schemaKey: "nodex.page",
    });
    expect(result.value.dataSourceContext.kind).toBe("member");
    if (result.value.dataSourceContext.kind !== "member") return;
    const status = result.value.dataSourceContext.properties.find(
      (property) => property.propertyId === "status",
    );
    expect(status?.dataSourceId).toBe(
      result.value.dataSourceContext.dataSource.dataSourceId,
    );
    expect(status && result.value.dataSourceContext.values[status.propertyId]?.value)
      .toBe("in_progress");
  });

  test("evaluates recursive Page grants without exposing sibling rows", async () => {
    const executor = createProject({ name: "Executor" });
    const owner = createProject({ name: "Owner" });
    const granted = await createPage(owner.id, "draft", { title: "Granted" });
    const sibling = await createPage(owner.id, "draft", { title: "Sibling" });

    expect(
      readPageDetailInDatabase(getDb(), executor.id, granted.id),
    ).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
    putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "page", pageId: granted.id },
      access: "read",
    });
    const detail = readPageDetailInDatabase(getDb(), executor.id, granted.id);
    expect(detail.ok && detail.value.page.pageId).toBe(granted.id);
    expect(
      readPageDetailInDatabase(getDb(), executor.id, sibling.id),
    ).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
  });

  test("rejects a Source-parented Page without exactly one active membership", async () => {
    const project = createProject({ name: "Corrupt" });
    const created = await createPage(project.id, "draft", { title: "Page" });
    getDb().prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE page_block_id = ? AND removed_at IS NULL
    `).run(new Date().toISOString(), created.id);

    expect(
      readPageDetailInDatabase(getDb(), project.id, created.id),
    ).toMatchObject({
      ok: false,
      error: { code: "page_detail_corrupt" },
    });
  });
});
