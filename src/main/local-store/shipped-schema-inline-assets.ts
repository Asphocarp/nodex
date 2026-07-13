import type Database from "better-sqlite3";
import {
  type NfmBlock,
  type NfmInlineContent,
  parseNfm,
  serializeNfm,
} from "../../shared/nfm";
import { summarizeCardDescription } from "../../shared/card-summary";
import { materializeInlineImageAtRoot } from "./assets";

const isInlineImageDataUrl = (value: string): boolean =>
  value.startsWith("data:image/");

const materializeInlineContent = (
  content: readonly NfmInlineContent[],
  assetsRootPath: string,
): NfmInlineContent[] =>
  content.map((item) => {
    if (item.type !== "attachment" || !isInlineImageDataUrl(item.source)) {
      return item;
    }
    const managed = materializeInlineImageAtRoot(item.source, {
      assetsRootPath,
      namespace: "legacy-card",
    });
    return {
      ...item,
      source: managed.source,
      mimeType: managed.mimeType,
    };
  });

const materializeBlock = (
  block: NfmBlock,
  assetsRootPath: string,
): NfmBlock => {
  const children = block.children.map((child) =>
    materializeBlock(child, assetsRootPath),
  );
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "bulletListItem":
    case "numberedListItem":
    case "checkListItem":
    case "toggle":
    case "blockquote":
    case "callout":
    case "cardToggle":
      return {
        ...block,
        content: materializeInlineContent(block.content, assetsRootPath),
        children,
      };
    case "table":
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: materializeInlineContent(cell.content, assetsRootPath),
          })),
        })),
        children,
      };
    case "image": {
      const managed = isInlineImageDataUrl(block.source)
        ? materializeInlineImageAtRoot(block.source, {
            assetsRootPath,
            namespace: "legacy-card",
          })
        : null;
      return {
        ...block,
        source: managed?.source ?? block.source,
        caption: materializeInlineContent(block.caption, assetsRootPath),
        children,
      };
    }
    default:
      return { ...block, children };
  }
};

/** Normalize only the staging snapshot; the shipped source stays byte-stable. */
export const materializeLegacyCardInlineImages = (
  database: Database.Database,
  assetsRootPath: string,
): number => {
  const rows = database
    .prepare(
      `SELECT id, description
       FROM cards
       WHERE instr(description, 'data:image/') > 0
       ORDER BY id`,
    )
    .all() as readonly {
    readonly id: string;
    readonly description: string;
  }[];
  if (rows.length === 0) return 0;

  const update = database.prepare(
    `UPDATE cards
     SET description = ?, description_preview = ?, description_length = ?,
       has_description = ?, description_read_model_revision = revision
     WHERE id = ? AND description = ?`,
  );
  return database
    .transaction(() =>
      rows.reduce((changed, row) => {
        const nextDescription = serializeNfm(
          parseNfm(row.description).map((block) =>
            materializeBlock(block, assetsRootPath),
          ),
        );
        if (nextDescription === row.description) return changed;
        const summary = summarizeCardDescription(nextDescription);
        const result = update.run(
          nextDescription,
          summary.descriptionPreview,
          summary.descriptionLength,
          summary.hasDescription ? 1 : 0,
          row.id,
          row.description,
        );
        if (result.changes !== 1) {
          throw new Error(`Legacy Card ${row.id} changed during v57 import`);
        }
        return changed + 1;
      }, 0),
    )
    .immediate();
};
