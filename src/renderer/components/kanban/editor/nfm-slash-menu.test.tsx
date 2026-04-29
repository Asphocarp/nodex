import { describe, expect, test } from "bun:test";
import { getNfmSlashMenuCustomItems } from "./nfm-slash-menu";

describe("NfmSlashMenu", () => {
  test("agent config item inserts a plan-mode chip", () => {
    let insertedContent: unknown[] | null = null;
    let insertedUpdateSelection: boolean | null = null;
    const editor = {
      insertInlineContent: (content: unknown[], options?: { updateSelection?: boolean }) => {
        insertedContent = content;
        insertedUpdateSelection = options?.updateSelection ?? null;
      },
    };

    const item = getNfmSlashMenuCustomItems(editor, "default").find((candidate) => candidate.title === "Agent Config");
    expect(item !== undefined).toBeTrue();
    if (!item) return;

    item.onItemClick();

    expect(Array.isArray(insertedContent)).toBeTrue();
    const chip = insertedContent?.[0] as { type?: string; props?: Record<string, string> } | undefined;
    expect(chip?.type).toBe("agentConfig");
    expect(chip?.props?.mode).toBe("plan");
    expect(chip?.props?.model).toBe("");
    expect(chip?.props?.reasoning).toBe("");
    expect(insertedContent?.[1]).toBe(" ");
    expect(insertedUpdateSelection).toBeTrue();
  });
});
