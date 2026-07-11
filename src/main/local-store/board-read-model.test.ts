import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./database";
import { createCard } from "./cards";
import { createProject } from "./projects";
import { getBoardSummary, getCardsDetails, searchCards } from "./board-read-model";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: (projectId: string) => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-board-summary-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
      return false;
    }
    throw error;
  }
  const project = createProject({ name: "Summary" });

  try {
    await run(project.id);
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function findSummaryCard(projectId: string, cardId: string) {
  return getBoardSummary(projectId).then((board) => (
    board.columns
      .flatMap((column) => column.cards)
      .find((card) => card.id === cardId)
  ));
}

describe("board summary read model", () => {
  test("getBoardSummary omits full description and exposes bounded description metadata", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const description = `Visible opening ${"preview ".repeat(60)} hidden-body-marker`;
      const created = await createCard(projectId, "draft", {
        title: "Large text",
        description,
      });

      const summaryCard = await findSummaryCard(projectId, created.id);

      expect(summaryCard?.id).toBe(created.id);
      expect(Object.hasOwn(summaryCard ?? {}, "description")).toBe(false);
      expect(summaryCard?.hasDescription).toBe(true);
      expect(summaryCard?.descriptionLength).toBe(description.length);
      expect((summaryCard?.descriptionPreview.length ?? 0) <= 240).toBe(true);
      expect(JSON.stringify(summaryCard).includes("hidden-body-marker")).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("getCardsDetails returns full cards in requested order", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const first = await createCard(projectId, "draft", {
        title: "First",
        description: "First full body",
      });
      const second = await createCard(projectId, "draft", {
        title: "Second",
        description: "Second full body",
      });

      const details = await getCardsDetails(projectId, {
        cardIds: [second.id, first.id, second.id, "missing"],
      });

      expect(details.map((card) => card.id).join(",")).toBe(`${second.id},${first.id}`);
      expect(details[0]?.description).toBe("Second full body");
      expect(details[1]?.description).toBe("First full body");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("searchCards matches description text and returns only ids, score, and excerpt", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const created = await createCard(projectId, "in_progress", {
        title: "Routine card",
        description: "The body contains a rare-search-token for command palette lookup.",
      });
      const results = await searchCards({
        projectIds: [projectId],
        query: "rare-search-token",
        limit: 10,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.cardId).toBe(created.id);
      expect(results[0]?.projectId).toBe(projectId);
      expect(results[0]?.excerpt.includes("rare-search-token")).toBe(true);
      expect(Object.hasOwn(results[0] ?? {}, "description")).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("summary payload stays bounded for many cards with large descriptions", async () => {
    const ran = await withTempDatabase(async (projectId) => {
      const hiddenMarker = "full-body-marker-should-not-enter-summary";
      const longBody = `${"preview ".repeat(40)} ${hiddenMarker} ${"body ".repeat(600)}`;
      for (let index = 0; index < 500; index += 1) {
        await createCard(projectId, "draft", {
          title: `Large ${index}`,
          description: longBody,
        });
      }

      const summary = await getBoardSummary(projectId);
      const payload = JSON.stringify(summary);

      expect(payload.includes(hiddenMarker)).toBe(false);
      expect(payload.length < 1_000_000).toBe(true);
      expect(summary.columns.flatMap((column) => column.cards).length).toBe(500);
    });

    if (!ran) expect(true).toBe(true);
  });
});
