import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";

import { NodexTooltipProvider } from "@/components/ui/tooltip";
import "../../../globals.css";
import { nfmSchema } from "./nfm-schema";
import { PageFileRuntimeProvider, type PageFilePlacementRuntime } from "./page-file-runtime";

const settleEditor = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

describe("attachment chip File icons", () => {
  test("uses the same format icon in the chip and its popover", async () => {
    const pageFileRuntime: PageFilePlacementRuntime = {
      authority: {
        contentAccessContext: { kind: "project", projectId: "project-1" },
        pageId: "page-1",
        storeEpoch: "store-1",
      },
      authorityVersion: 1,
      upload: async () => "nodex://files/file-1",
      read: async () => ({
        bytes: new Uint8Array(),
        mimeType: "video/webm",
        etag: "etag-1",
      }),
      metadata: async () => ({
        fileId: "file-1",
        ownerPageId: "page-1",
        logicalPath: "videos/review.webm",
        mimeType: "video/webm",
        byteLength: 0,
        version: 1,
        blobEtag: "etag-1",
        state: "live",
        createdByActorId: "actor-1",
        createdByTurnId: null,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
      }),
      readImageDataUrl: async () => "data:image/png;base64,",
      save: async () => undefined,
    };
    const editor = BlockNoteEditor.create({
      schema: nfmSchema,
      initialContent: [
        {
          id: "attachment-block",
          type: "paragraph",
          content: [
            {
              type: "attachment",
              props: {
                kind: "file",
                mode: "materialized",
                source: "nodex://files/file-1",
                name: "stale.bin",
                mimeType: "application/octet-stream",
              },
            },
          ],
        },
      ],
    });
    const view = render(
      <NodexTooltipProvider>
        <PageFileRuntimeProvider value={pageFileRuntime}>
          <BlockNoteView
            editor={editor}
            formattingToolbar={false}
            linkToolbar={false}
            slashMenu={false}
            sideMenu={false}
            tableHandles={false}
          />
        </PageFileRuntimeProvider>
      </NodexTooltipProvider>,
    );

    try {
      await act(settleEditor);
      const label = await view.findByText("review.webm");
      const chip = label.closest("button");
      expect(chip).not.toBeNull();
      if (!chip) throw new Error("Attachment chip was not rendered");
      expect(chip.getAttribute("data-inline-reference-chip")).toBe("true");
      expect(chip.getAttribute("data-attachment-inline-chip")).toBe("true");
      expect(chip.getAttribute("data-mention-inline-chip")).toBeNull();
      expect(getComputedStyle(chip).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(label).textDecorationLine).toContain("underline");
      const inlineContent = chip.closest<HTMLElement>(".bn-inline-content-section");
      expect(inlineContent).not.toBeNull();
      if (!inlineContent) throw new Error("Attachment inline-content host was not rendered");
      expect(Number.parseFloat(getComputedStyle(chip).fontSize)).toBeCloseTo(
        Number.parseFloat(getComputedStyle(inlineContent).fontSize),
        3,
      );
      const chipIcon = chip.querySelector<SVGSVGElement>('[data-file-tab-icon="file"]');
      expect(chipIcon).not.toBeNull();
      const chipIconGeometry = chipIcon?.querySelector("path")?.getBBox();
      const chipIconBox = chipIcon?.getBoundingClientRect();
      const opticalHeight =
        ((chipIconGeometry?.height ?? 0) / (chipIcon?.viewBox.baseVal.height ?? 1)) *
        (chipIconBox?.height ?? 0);
      expect(chipIconBox?.height).toBeCloseTo(16, 1);
      expect(opticalHeight).toBeGreaterThan(12);
      expect(opticalHeight).toBeLessThan(13);

      await act(async () => {
        if (chip) fireEvent.click(chip);
        await settleEditor();
      });

      await waitFor(() => {
        const popover = document.body.querySelector('[data-slot="popover-content"]');
        expect(popover?.querySelector('[data-file-tab-icon="file"]')).not.toBeNull();
      });
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });
});
