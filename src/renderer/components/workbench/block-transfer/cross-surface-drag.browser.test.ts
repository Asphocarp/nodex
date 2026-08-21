import { describe, expect, test } from "vite-plus/test";
import {
  encodeBlockTransferDragPayload,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  parseBlockTransferDragPayload,
} from "./cross-surface-drag";

describe("cross-surface Block transfer in Chromium", () => {
  test("preserves the stable-ID payload through a native DataTransfer", () => {
    const transfer = new DataTransfer();
    transfer.setData(
      NODEX_BLOCK_TRANSFER_DRAG_MIME,
      encodeBlockTransferDragPayload({
        sessionId: "session-a",
        sourceSurfaceId: "surface-a",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        source: { kind: "document", documentId: "document-a" },
        rootBlockIds: ["block-a"],
        displayHints: ["paragraph"],
      }),
    );

    expect(
      parseBlockTransferDragPayload(transfer.getData(NODEX_BLOCK_TRANSFER_DRAG_MIME)),
    ).toMatchObject({ rootBlockIds: ["block-a"] });
  });
});
