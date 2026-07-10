import { describe, expect, test } from "bun:test";
import { parseNfm } from "../nfm/parser";
import { nfmToBlockNoteWithIds } from "./nfm-blocknote-adapter";

describe("NFM BlockNote genesis adapter", () => {
  test("allocates one stable application identity for every nested Block", () => {
    let nextId = 0;
    const blocks = nfmToBlockNoteWithIds(
      parseNfm("Parent\n\t- Child\n\t\tGrandchild\nSibling"),
      () => `block-${++nextId}`,
    );

    expect(nextId).toBe(4);
    expect(blocks[0]?.id).toBe("block-1");
    expect(blocks[0]?.children?.[0]?.id).toBe("block-2");
    expect(blocks[0]?.children?.[0]?.children?.[0]?.id).toBe("block-3");
    expect(blocks[1]?.id).toBe("block-4");
  });

  test("fails genesis when the identity allocator repeats an ID", () => {
    let message = "";
    try {
      nfmToBlockNoteWithIds(parseNfm("First\nSecond"), () => "duplicate");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(
      "Block ID allocator returned an invalid or duplicate identity",
    );
  });
});
