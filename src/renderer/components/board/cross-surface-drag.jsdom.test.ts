import { describe, expect, test } from "vitest";
import {
  BlockDragSessionCoordinator,
  blockTransferDropLabel,
  buildBlockToDataSourceTransferIntent,
  containsDatabaseBlockDrag,
  encodeBlockTransferDragPayload,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  parseBlockTransferDragPayload,
  resolveCrossSurfaceTransferMode,
  shouldBlockNoteYieldManagedDrag,
} from "./cross-surface-drag";

describe("cross-surface Block transfer drag", () => {
  test("round-trips stable identities and parent authority without content snapshots", () => {
    const serialized = encodeBlockTransferDragPayload({
      sessionId: "session-a",
      sourceSurfaceId: "surface-a",
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
      sessionId: "session-a",
      sourceSurfaceId: "surface-a",
      projectId: "project-a",
      storeEpoch: "epoch-a",
      source: { kind: "library", libraryId: "library-a" },
      rootBlockIds: ["block-a", "block-a"],
      displayHints: ["One", "Two"],
    });
    expect(parseBlockTransferDragPayload(duplicate)).toBeNull();
    expect(parseBlockTransferDragPayload("x".repeat(256 * 1024 + 1))).toBeNull();
  });

  test("defaults to Move and samples Option/Alt at feedback and drop time", () => {
    expect(resolveCrossSurfaceTransferMode({ altKey: false })).toBe("move");
    expect(resolveCrossSurfaceTransferMode({ altKey: true })).toBe("copy");
    expect(blockTransferDropLabel("move", "data_source")).toBe("Move to Database");
    expect(blockTransferDropLabel("copy", "page")).toBe("Copy into page");
  });

  test("recognizes Database owners as unsupported generic drag sources", () => {
    expect(containsDatabaseBlockDrag({ displayHints: ["database"] })).toBe(true);
    expect(containsDatabaseBlockDrag({ displayHints: ["page", "paragraph"] })).toBe(false);
  });

  test("compiles an editor session into one Database-parent transfer", () => {
    const payload = parseBlockTransferDragPayload(
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
    if (!payload) throw new Error("Expected a valid Block drag payload");

    expect(
      buildBlockToDataSourceTransferIntent({
        operationId: "operation-a",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        payload,
        dataSourceId: "source-a",
        viewId: "view-a",
        groupKey: "in-progress",
        beforePageId: "card-b",
        altKey: true,
        promotionPolicy: "task_shorthand_v1",
      }),
    ).toEqual({
      version: 3,
      operationId: "operation-a",
      projectId: "project-a",
      storeEpoch: "epoch-a",
      mode: "copy",
      rootBlockIds: ["block-a"],
      causalDependencies: [],
      source: { kind: "document", documentId: "document-a" },
      target: {
        kind: "data_source",
        dataSourceId: "source-a",
        viewId: "view-a",
        groupKey: "in-progress",
        beforePageId: "card-b",
      },
      promotionPolicy: "task_shorthand_v1",
    });
  });

  test("accepts the custom MIME only while a local editor owns the native drag", () => {
    const coordinator = new BlockDragSessionCoordinator(() => "session-local");
    const values = new Map<string, string>();
    const types: string[] = [];
    const transfer = {
      types,
      effectAllowed: "uninitialized",
      setData: (type: string, value: string) => {
        if (!types.includes(type)) types.push(type);
        values.set(type, value);
      },
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;

    expect(coordinator.resolve(transfer)).toBeNull();
    const session = coordinator.start(
      {
        sourceSurfaceId: "surface-a",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        source: { kind: "document", documentId: "document-a" },
        rootBlockIds: ["block-a"],
        displayHints: ["paragraph"],
      },
      transfer,
    );
    expect(coordinator.resolve(transfer)).toEqual(session);
    expect(transfer.effectAllowed).toBe("copyMove");
    expect(
      parseBlockTransferDragPayload(
        values.get(NODEX_BLOCK_TRANSFER_DRAG_MIME) ?? "",
      ),
    ).toMatchObject({
      sessionId: "session-local",
      sourceSurfaceId: "surface-a",
      rootBlockIds: ["block-a"],
    });
    expect(coordinator.resolveDrop(transfer)).toEqual(session);
    values.set(
      NODEX_BLOCK_TRANSFER_DRAG_MIME,
      encodeBlockTransferDragPayload({
        ...session.payload,
        sessionId: "stale-session",
      }),
    );
    expect(coordinator.resolveDrop(transfer)).toBeNull();
    values.set(
      NODEX_BLOCK_TRANSFER_DRAG_MIME,
      encodeBlockTransferDragPayload(session.payload),
    );

    coordinator.end({ sourceSurfaceId: "another-surface" });
    expect(coordinator.resolve(transfer)).toEqual(session);
    coordinator.end({ sessionId: "session-local" });
    expect(coordinator.resolve(transfer)).toBeNull();
  });

  test("preserves native same-surface reorder while yielding every cross-surface path", () => {
    const surface = document.createElement("div");
    const content = document.createElement("div");
    surface.className = "nfm-editor";
    surface.append(content);
    const session = {
      sessionId: "session-a",
      sourceSurfaceId: "surface-a",
      payload: parseBlockTransferDragPayload(
        encodeBlockTransferDragPayload({
          sessionId: "session-a",
          sourceSurfaceId: "surface-a",
          projectId: "project-a",
          storeEpoch: "epoch-a",
          source: { kind: "document", documentId: "document-a" },
          rootBlockIds: ["block-a"],
          displayHints: ["paragraph"],
        }),
      )!,
    };

    expect(
      shouldBlockNoteYieldManagedDrag({
        session,
        currentSurfaceId: "surface-a",
        currentSurfaceElement: surface,
        eventTarget: content,
      }),
    ).toBe(false);
    expect(
      shouldBlockNoteYieldManagedDrag({
        session,
        currentSurfaceId: "surface-b",
        currentSurfaceElement: surface,
        eventTarget: content,
      }),
    ).toBe(true);
    expect(
      shouldBlockNoteYieldManagedDrag({
        session,
        currentSurfaceId: "surface-a",
        currentSurfaceElement: surface,
        eventTarget: document.body,
      }),
    ).toBe(true);
  });
});
