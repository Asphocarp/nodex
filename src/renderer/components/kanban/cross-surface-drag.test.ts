import { describe, expect, test } from "vitest";
import {
  beginLocalNativeEditorDrag,
  blockTransferDropLabel,
  encodeBlockTransferDragPayload,
  endLocalNativeEditorDrag,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  parseBlockTransferDragPayload,
  resolveCrossSurfaceTransferMode,
  shouldHandleNativeCrossSurfaceDrag,
} from "./cross-surface-drag";

describe("cross-surface Block transfer drag", () => {
  test("round-trips stable identities and parent authority without content snapshots", () => {
    const serialized = encodeBlockTransferDragPayload({
      projectId: "project-a",
      storeEpoch: "epoch-a",
      source: { kind: "document", documentId: "document-a" },
      rootBlockIds: ["paragraph-a", "card-a"],
      displayHints: ["paragraph", "Card A"],
    });

    expect(parseBlockTransferDragPayload(serialized)).toMatchObject({
      source: { kind: "document", documentId: "document-a" },
      rootBlockIds: ["paragraph-a", "card-a"],
    });
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("content");
  });

  test("rejects duplicate identities and unbounded payloads", () => {
    const duplicate = encodeBlockTransferDragPayload({
      projectId: "project-a",
      storeEpoch: "epoch-a",
      source: { kind: "space" },
      rootBlockIds: ["block-a", "block-a"],
      displayHints: ["One", "Two"],
    });
    expect(parseBlockTransferDragPayload(duplicate)).toBeNull();
    expect(parseBlockTransferDragPayload("x".repeat(256 * 1024 + 1))).toBeNull();
  });

  test("defaults to Move and samples Option/Alt at feedback and drop time", () => {
    expect(resolveCrossSurfaceTransferMode({ altKey: false })).toBe("move");
    expect(resolveCrossSurfaceTransferMode({ altKey: true })).toBe("copy");
    expect(blockTransferDropLabel("move", "database")).toBe("Move to Database");
    expect(blockTransferDropLabel("copy", "document")).toBe("Copy into page");
  });

  test("accepts the custom MIME only while a local editor owns the native drag", () => {
    const editor = document.createElement("div");
    const transfer = { types: [NODEX_BLOCK_TRANSFER_DRAG_MIME] };
    expect(shouldHandleNativeCrossSurfaceDrag(transfer)).toBe(false);
    beginLocalNativeEditorDrag(editor);
    expect(shouldHandleNativeCrossSurfaceDrag(transfer)).toBe(true);
    endLocalNativeEditorDrag(editor);
    expect(shouldHandleNativeCrossSurfaceDrag(transfer)).toBe(false);
  });
});
