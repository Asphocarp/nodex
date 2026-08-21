import { describe, expect, test } from "vitest";
import { finalizeSideMenuBlockDrag } from "./side-menu-drag-lifecycle";

describe("finalizeSideMenuBlockDrag", () => {
  test("clears ProseMirror dragging and delegates to the side-menu cleanup", () => {
    let blockDragEnded = false;
    const editor = {
      prosemirrorView: {
        dragging: { id: "dragging" },
        root: {
          querySelectorAll: () => [],
        },
      },
      getExtension: () => ({
        blockDragEnd: () => {
          blockDragEnded = true;
        },
      }),
    };

    finalizeSideMenuBlockDrag(editor as unknown as Parameters<typeof finalizeSideMenuBlockDrag>[0]);

    expect(editor.prosemirrorView.dragging).toBe(null);
    expect(blockDragEnded).toBe(true);
  });

  test("removes orphaned drag previews when blockDragEnd is unavailable", () => {
    let removed = 0;
    const editor = {
      prosemirrorView: {
        dragging: { id: "dragging" },
        root: {
          querySelectorAll: () => [
            {
              remove: () => {
                removed += 1;
              },
            },
            {
              remove: () => {
                removed += 1;
              },
            },
          ],
        },
      },
      getExtension: () => null,
    };

    finalizeSideMenuBlockDrag(editor as unknown as Parameters<typeof finalizeSideMenuBlockDrag>[0]);

    expect(editor.prosemirrorView.dragging).toBe(null);
    expect(removed).toBe(2);
  });

  test("does not throw when Tiptap root is unavailable during unmount cleanup", () => {
    let blockDragEnded = false;
    const editor = {
      prosemirrorView: {
        dragging: { id: "dragging" },
        get root(): Document | ShadowRoot {
          throw new Error("[tiptap error]: The editor view is not available.");
        },
      },
      getExtension: () => ({
        blockDragEnd: () => {
          blockDragEnded = true;
        },
      }),
    };

    finalizeSideMenuBlockDrag(editor as unknown as Parameters<typeof finalizeSideMenuBlockDrag>[0]);

    expect(editor.prosemirrorView.dragging).toBe(null);
    expect(blockDragEnded).toBe(false);
  });
});
