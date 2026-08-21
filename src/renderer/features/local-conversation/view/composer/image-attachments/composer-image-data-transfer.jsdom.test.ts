import { describe, expect, test, vi } from "vitest";
import {
  classifyComposerDataTransfer,
  isComposerMediaOnlyHtml,
  isSupportedComposerImageFile,
  isSupportedComposerImageMetadata,
} from "./composer-image-data-transfer";

function transfer(input: {
  readonly files?: readonly File[];
  readonly itemFiles?: readonly (File | null)[];
  readonly text?: string;
  readonly html?: string;
}): DataTransfer {
  const files = input.files ?? [];
  const itemFiles = input.itemFiles ?? files;
  return {
    files,
    items: itemFiles.map((file) => ({
      kind: "file",
      type: file?.type ?? "",
      getAsFile: () => file,
    })),
    getData: vi.fn((type: string) => {
      if (type === "text/plain") return input.text ?? "";
      if (type === "text/html") return input.html ?? "";
      return "";
    }),
  } as unknown as DataTransfer;
}

describe("composer image DataTransfer classification", () => {
  test("accepts only the authored image MIME and extension set and rejects empty files", () => {
    expect(
      isSupportedComposerImageFile(new File(["x"], "photo.bin", { type: "image/x-png" })),
    ).toBe(true);
    expect(
      isSupportedComposerImageFile(
        new File(["x"], "photo.WEBP", { type: "application/octet-stream" }),
      ),
    ).toBe(true);
    expect(isSupportedComposerImageFile(new File(["x"], "photo.bmp", { type: "image/bmp" }))).toBe(
      false,
    );
    expect(isSupportedComposerImageFile(new File([], "empty.png", { type: "image/png" }))).toBe(
      false,
    );
    expect(
      isSupportedComposerImageMetadata({
        filename: "picked.jpeg",
        mimeType: "application/octet-stream",
      }),
    ).toBe(true);
  });

  test("uses item files only when they contain more usable files than FileList", () => {
    const first = new File(["1"], "first.png", { type: "image/png" });
    const second = new File(["2"], "second.png", { type: "image/png" });

    expect(
      classifyComposerDataTransfer(
        transfer({
          files: [first],
          itemFiles: [first, second, null],
        }),
      ).imageFiles,
    ).toEqual([first, second]);
    expect(
      classifyComposerDataTransfer(
        transfer({
          files: [first, second],
          itemFiles: [first],
        }),
      ).imageFiles,
    ).toEqual([first, second]);
  });

  test("consumes image-only and filename-only clipboard payloads", () => {
    const image = new File(["image"], "diagram.png", { type: "image/png" });

    expect(classifyComposerDataTransfer(transfer({ files: [image] }))).toMatchObject({
      disposition: "consume-files",
      hasMeaningfulText: false,
    });
    expect(
      classifyComposerDataTransfer(
        transfer({
          files: [image],
          text: "file:///tmp/diagram.png",
        }),
      ),
    ).toMatchObject({ disposition: "consume-files", hasMeaningfulText: false });
  });

  test("preserves real text unless the HTML payload is media-only", () => {
    const image = new File(["image"], "diagram.png", { type: "image/png" });

    expect(
      classifyComposerDataTransfer(
        transfer({
          files: [image],
          text: "Keep this note",
          html: "<p>Keep this note</p><img src='data:image/png;base64,aQ=='>",
        }),
      ).disposition,
    ).toBe("pass-through");
    expect(
      classifyComposerDataTransfer(
        transfer({
          files: [image],
          text: "Clipboard image",
          html: "<div hidden>Clipboard image</div><img src='data:image/png;base64,aQ=='>",
        }),
      ),
    ).toMatchObject({ disposition: "consume-files", isMediaOnlyHtml: true });
  });

  test("recognizes visible media while ignoring metadata and media descendants", () => {
    expect(
      isComposerMediaOnlyHtml(
        "<style>.x{color:red}</style><svg><title>Preview</title><text>vector</text></svg>",
      ),
    ).toBe(true);
    expect(isComposerMediaOnlyHtml("<img src='x'><span>caption</span>")).toBe(false);
    expect(isComposerMediaOnlyHtml(`<img src='x'>${"x".repeat(100_001)}`)).toBe(false);
  });

  test("consumes ordinary files even when clipboard text is meaningful", () => {
    const documentFile = new File(["content"], "notes.md", { type: "text/markdown" });
    expect(
      classifyComposerDataTransfer(
        transfer({
          files: [documentFile],
          text: "Keep this text too",
        }),
      ),
    ).toMatchObject({
      disposition: "consume-files",
      imageFiles: [],
      otherFiles: [documentFile],
    });
  });
});
