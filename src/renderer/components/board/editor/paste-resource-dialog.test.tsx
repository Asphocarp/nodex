import { describe, expect, vi, test } from "vitest";
import type { ComponentProps } from "react";
import { render, textContent } from "../../../test/dom";

vi.mock("./paste-resource-dialog-deps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./paste-resource-dialog-deps")>()),
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  Dialog: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogDescription: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

describe("paste resource dialog", () => {
  test("renders link action only when the current paste supports it", async () => {
    const { PasteResourceDialog } = await import("./paste-resource-dialog");
    const withLinkRender = render(
      <PasteResourceDialog
        open
        state={{
          target: {
            selectedBlockIds: [],
            currentBlockId: "block-1",
            canInsertInline: true,
            replaceCurrentEmptyParagraph: true,
          },
          items: [{ kind: "file", name: "report.txt", path: "/tmp/report.txt" }],
          allowLink: true,
        }}
        onOpenChange={() => {}}
        onChooseMode={() => {}}
        onContinueInline={() => {}}
      />,
    );
    const withoutLinkRender = render(
      <PasteResourceDialog
        open
        state={{
          target: {
            selectedBlockIds: [],
            currentBlockId: "block-1",
            canInsertInline: true,
            replaceCurrentEmptyParagraph: true,
          },
          items: [{ kind: "file", name: "report.txt", mimeType: "text/plain" }],
          allowLink: false,
        }}
        onOpenChange={() => {}}
        onChooseMode={() => {}}
        onContinueInline={() => {}}
      />,
    );

    expect(textContent(withLinkRender.container).includes("Keep as Link")).toBe(true);
    expect(textContent(withoutLinkRender.container).includes("Keep as Link")).toBe(false);
    expect(textContent(withoutLinkRender.container).includes("Save a Copy")).toBe(true);
  });

  test("renders user-friendly oversized-text actions without link mode", async () => {
    const { PasteResourceDialog } = await import("./paste-resource-dialog");
    const pastedText = `# Incident note

The worker queue backed up after a large sync finished at 09:14.
Please keep the markdown formatting when this is pasted inline.`;
    const { container } = render(
      <PasteResourceDialog
        open
        state={{
          target: {
            selectedBlockIds: [],
            currentBlockId: "block-1",
            canInsertInline: true,
            replaceCurrentEmptyParagraph: true,
          },
          items: [{ kind: "text", name: "Pasted text" }],
          textPayload: pastedText,
          allowLink: false,
        }}
        onOpenChange={() => {}}
        onChooseMode={() => {}}
        onContinueInline={() => {}}
      />,
    );

    expect(textContent(container).includes("Paste Anyway")).toBe(true);
    expect(textContent(container).includes("Keep as Link")).toBe(false);
    expect(
      textContent(container).includes(
        "Save a copy to assets and link to it, paste it anyway, or cancel.",
      ),
    ).toBe(true);
    expect(textContent(container).includes("# Incident note")).toBe(true);
    expect(textContent(container).includes("145 characters")).toBe(true);
    expect(textContent(container).includes("4 lines")).toBe(true);
  });

  test("hides save copy for folder paste and keeps link action", async () => {
    const { PasteResourceDialog } = await import("./paste-resource-dialog");
    const { container } = render(
      <PasteResourceDialog
        open
        state={{
          target: {
            selectedBlockIds: [],
            currentBlockId: "block-1",
            canInsertInline: true,
            replaceCurrentEmptyParagraph: true,
          },
          items: [{ kind: "folder", name: "Designs", path: "/tmp/Designs" }],
          allowLink: true,
        }}
        onOpenChange={() => {}}
        onChooseMode={() => {}}
      />,
    );

    expect(textContent(container).includes("Keep as Link")).toBe(true);
    expect(textContent(container).includes("Save a Copy")).toBe(false);
    expect(textContent(container).includes("Keep a link to the original folder, or cancel.")).toBe(
      true,
    );
  });
});
