import { describe, expect, test, vi } from "vitest";

import { isUuidV7 } from "../../shared/uuid-v7";

const api = vi.hoisted(() => ({
  applyLibraryModule: vi.fn(),
  preparePageFile: vi.fn(),
  readLibraryModule: vi.fn(),
  readPageFileBytes: vi.fn(),
  savePageFile: vi.fn(),
}));

vi.mock("./api", () => api);

import {
  allocatePageFilePath,
  createOwnedPageFile,
  portablePageFilePathKey,
  prepareBrowserPageFiles,
  readCompletePageFileManifest,
  validateBrowserPageFileBatch,
} from "./page-file-resources";

describe("Page File path allocation", () => {
  test("suffixes portable Unicode and case collisions while preserving directories", () => {
    const occupied = new Set([
      portablePageFilePathKey("references/Brief.PDF"),
      portablePageFilePathKey("references/brief (2).pdf"),
    ]);

    expect(allocatePageFilePath("references/brief.pdf", occupied)).toBe("references/brief (3).pdf");
    expect(
      allocatePageFilePath(
        "assets/Cafe\u0301.png",
        new Set([portablePageFilePathKey("assets/Café.png")]),
      ),
    ).toBe("assets/Café (2).png");
  });

  test("uses canonical UUID-v7 identities across prepare and apply", async () => {
    api.preparePageFile.mockResolvedValue({
      receiptId: "prepared-receipt",
      logicalPath: "diagram.png",
      mimeType: "image/png",
      byteLength: 7,
    });
    api.readLibraryModule.mockResolvedValue({
      ok: true,
      value: {
        value: {
          kind: "page_files",
          value: {
            pageId: "page-1",
            revision: 0,
            bodyUsageRevision: 0,
            files: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
          },
        },
      },
    });
    api.applyLibraryModule.mockResolvedValue({ ok: true, value: {} });

    await createOwnedPageFile(
      {
        contentAccessContext: { kind: "project", projectId: "project-1" },
        pageId: "page-1",
        storeEpoch: "store-1",
      },
      {
        kind: "browser_file",
        file: new File(["diagram"], "diagram.png", { type: "image/png" }),
      },
    );

    const prepareInput = api.preparePageFile.mock.calls[0]?.[1];
    const applyInput = api.applyLibraryModule.mock.calls[0]?.[1];
    expect(isUuidV7(prepareInput?.operationId)).toBe(true);
    expect(applyInput?.operationId).toBe(prepareInput?.operationId);
    expect(isUuidV7(applyInput?.operation.changes[0]?.fileId)).toBe(true);
  });

  test("rejects an invalid browser batch before publishing any bytes", async () => {
    api.preparePageFile.mockReset();
    const oversized = {
      name: "oversized.bin",
      size: 64 * 1024 * 1024 + 1,
    } as File;

    expect(() => validateBrowserPageFileBatch([oversized])).toThrow(
      "oversized.bin exceeds the 64 MiB File limit",
    );
    await expect(
      prepareBrowserPageFiles({ kind: "project", projectId: "project-1" }, "operation-1", [
        oversized,
      ]),
    ).rejects.toThrow("oversized.bin exceeds the 64 MiB File limit");
    expect(api.preparePageFile).not.toHaveBeenCalled();
  });

  test("prepares a valid browser batch under one operation identity", async () => {
    api.preparePageFile.mockReset();
    api.preparePageFile
      .mockResolvedValueOnce({
        receiptId: "receipt-1",
        logicalPath: "brief.md",
        mimeType: "text/markdown",
        byteLength: 5,
      })
      .mockResolvedValueOnce({
        receiptId: "receipt-2",
        logicalPath: "data.json",
        mimeType: "application/json",
        byteLength: 2,
      });

    const files = [
      new File(["brief"], "brief.md", { type: "text/markdown" }),
      new File(["{}"], "data.json", { type: "application/json" }),
    ];
    const prepared = await prepareBrowserPageFiles(
      { kind: "project", projectId: "project-1" },
      "operation-1",
      files,
    );

    expect(prepared.map((file) => file.receiptId)).toEqual(["receipt-1", "receipt-2"]);
    expect(api.preparePageFile.mock.calls.map((call) => call[1].operationId)).toEqual([
      "operation-1",
      "operation-1",
    ]);
  });

  test("rejects a paginated inventory assembled across body usage revisions", async () => {
    api.readLibraryModule.mockReset();
    api.readLibraryModule
      .mockResolvedValueOnce({
        ok: true,
        value: {
          value: {
            kind: "page_files",
            value: {
              pageId: "page-1",
              revision: 3,
              bodyUsageRevision: 4,
              files: [],
              nextCursor: "next",
              hasMore: true,
              total: 0,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          value: {
            kind: "page_files",
            value: {
              pageId: "page-1",
              revision: 3,
              bodyUsageRevision: 5,
              files: [],
              nextCursor: null,
              hasMore: false,
              total: 0,
            },
          },
        },
      });

    await expect(
      readCompletePageFileManifest({ kind: "project", projectId: "project-1" }, "page-1"),
    ).rejects.toThrow("Page File body usage changed while Files were being read");
  });
});
