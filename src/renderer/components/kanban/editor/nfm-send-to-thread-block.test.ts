import { describe, expect, test } from "vitest";
import { blockNoteToNfm, serializeNfm } from "@/lib/nfm";
import { isUuidV7 } from "../../../../shared/card-id";
import { createSendToThreadToggleBlock } from "./nfm-send-to-thread-block";

describe("nfm send-to-thread block", () => {
  test("allocates a canonical Block identity by default", () => {
    const block = createSendToThreadToggleBlock({
      threadId: "thread-123",
      children: [],
    });

    expect(isUuidV7(block.id)).toBe(true);
  });

  test("creates a collapsed toggle with a thread mention and preserved children", () => {
    const block = createSendToThreadToggleBlock({
      blockId: "sent-toggle",
      threadId: "thread-123",
      children: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Original note", styles: {} }],
          children: [],
        },
      ],
    });

    const nfm = serializeNfm(blockNoteToNfm([block]));
    expect(nfm).toBe("▶ sent to <mention-thread uuid=\"thread-123\" />\n\tOriginal note");
  });
});
