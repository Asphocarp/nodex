import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, settleAsyncRender } from "@/test/dom";
import {
  NfmCompactLinkToolbar,
  NfmCreateLinkDialogSurface,
  NfmLinkEditDialogSurface,
} from "./nfm-link-toolbar-surface";

function renderToolbar(props?: Partial<Parameters<typeof NfmCompactLinkToolbar>[0]>) {
  return render(
    <NodexTooltipProvider>
      <NfmCompactLinkToolbar
        href="https://community.openai.com/t/example"
        canOpen={true}
        openTooltip="Open in new tab"
        copyLabel="Copy link"
        copyTooltip="Copy link"
        copiedLabel="Copied"
        copiedTooltip="Copied"
        editTooltip="Edit"
        editLabel="Edit"
        onOpenLink={() => {}}
        onCopyLink={() => {}}
        onEditLink={() => {}}
        {...props}
      />
    </NodexTooltipProvider>,
  );
}

describe("nfm compact link toolbar", () => {
  test("opens the link via the primary URL pill when actionable", async () => {
    let openCount = 0;

    const view = renderToolbar({
      onOpenLink: () => {
        openCount += 1;
      },
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open in new tab" }));
      await settleAsyncRender();
    });

    expect(openCount).toBe(1);
  });

  test("does not open blocked links and surfaces the disabled reason", async () => {
    const disabledReason = "Cannot resolve relative file link without project workspace.";
    let openCount = 0;

    const view = renderToolbar({
      canOpen: false,
      openTooltip: disabledReason,
      disabledReason,
      onOpenLink: () => {
        openCount += 1;
      },
    });

    const button = view.getByRole("button", { name: disabledReason });

    await act(async () => {
      fireEvent.mouseEnter(button);
      fireEvent.click(button);
      await settleAsyncRender();
    });

    expect(openCount).toBe(0);
    expect(button.getAttribute("title")).toBe(disabledReason);
  });

  test("copies the exact stored href through the copy action callback", async () => {
    let copiedHref = "";

    const view = renderToolbar({
      href: "folder/abc/file",
      onCopyLink: () => {
        copiedHref = "folder/abc/file";
      },
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy link" }));
      await settleAsyncRender();
    });

    expect(copiedHref).toBe("folder/abc/file");
  });

  test("shows the copied state in the copy action", () => {
    const view = renderToolbar({
      copyState: "copied",
    });

    const copyButton = view.getByRole("button", { name: "Copied" });
    expect(copyButton.getAttribute("aria-label")).toBe("Copied");
  });

  test("preserves the toolbar through pointerdown so copy click can still fire", async () => {
    let copied = 0;

    function ToolbarHarness() {
      const [open, setOpen] = useState(true);

      if (!open) return <div>Closed</div>;

      return (
        <div
          onPointerDown={(event) => {
            if (!event.defaultPrevented) setOpen(false);
          }}
        >
          <NodexTooltipProvider>
            <NfmCompactLinkToolbar
              href="https://community.openai.com/t/example"
              canOpen={true}
              openTooltip="Open in new tab"
              copyLabel="Copy link"
              copyTooltip="Copy link"
              copiedLabel="Copied"
              copiedTooltip="Copied"
              editTooltip="Edit"
              editLabel="Edit"
              onOpenLink={() => {}}
              onCopyLink={() => {
                copied += 1;
              }}
              onEditLink={() => {}}
            />
          </NodexTooltipProvider>
        </div>
      );
    }

    const view = render(<ToolbarHarness />);
    const copyButton = view.getByRole("button", { name: "Copy link" });

    await act(async () => {
      fireEvent.pointerDown(copyButton);
      fireEvent.click(copyButton);
      await settleAsyncRender();
    });

    expect(copied).toBe(1);
    expect(view.container.textContent?.includes("Closed") ?? false).toBe(false);
  });

  test("replaces the toolbar with the edit dialog when edit is clicked", async () => {
    function ToolbarHarness() {
      const [editing, setEditing] = useState(false);
      const [url, setUrl] = useState("https://community.openai.com/t/example");
      const [title, setTitle] = useState("OpenAI forum note");

      const handleFieldKeyDown = () => {};

      return (
        <NodexTooltipProvider>
          {editing ? (
            <NfmLinkEditDialogSurface
              urlLabel="Page or URL"
              titleLabel="Link title"
              urlPlaceholder="Paste or type a link"
              titlePlaceholder="Link title"
              urlValue={url}
              titleValue={title}
              removeLabel="Remove link"
              onUrlChange={setUrl}
              onTitleChange={setTitle}
              onUrlKeyDown={handleFieldKeyDown}
              onTitleKeyDown={handleFieldKeyDown}
              onRemoveLink={() => {}}
            />
          ) : (
            <NfmCompactLinkToolbar
              href={url}
              canOpen={true}
              openTooltip="Open in new tab"
              copyLabel="Copy link"
              copyTooltip="Copy link"
              copiedLabel="Copied"
              copiedTooltip="Copied"
              editTooltip="Edit"
              editLabel="Edit"
              onOpenLink={() => {}}
              onCopyLink={() => {}}
              onEditLink={() => {
                setEditing(true);
              }}
            />
          )}
        </NodexTooltipProvider>
      );
    }

    const view = render(<ToolbarHarness />);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Edit" }));
      await settleAsyncRender();
    });

    expect(view.queryByTestId("nfm-compact-link-toolbar") === null).toBe(true);
    expect(view.getByTestId("nfm-link-edit-dialog").getAttribute("role")).toBe("dialog");
    expect(Boolean(view.getByText("Page or URL"))).toBe(true);
  });
});

describe("nfm link edit dialog surface", () => {
  test("invokes the unlink action", async () => {
    let removed = 0;

    const view = render(
      <NfmLinkEditDialogSurface
        urlLabel="Page or URL"
        titleLabel="Link title"
        urlPlaceholder="Paste or type a link"
        titlePlaceholder="Link title"
        urlValue="https://community.openai.com/t/example"
        titleValue="OpenAI forum note"
        removeLabel="Remove link"
        onUrlChange={() => {}}
        onTitleChange={() => {}}
        onUrlKeyDown={() => {}}
        onTitleKeyDown={() => {}}
        onRemoveLink={() => {
          removed += 1;
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Remove link" }));
      await settleAsyncRender();
    });

    expect(removed).toBe(1);
  });

  test("renders the labeled URL and title fields", async () => {
    const view = render(
      <NfmLinkEditDialogSurface
        urlLabel="Page or URL"
        titleLabel="Link title"
        urlPlaceholder="Paste or type a link"
        titlePlaceholder="Link title"
        urlValue="https://community.openai.com/t/example"
        titleValue="OpenAI forum note"
        removeLabel="Remove link"
        onUrlChange={() => {}}
        onTitleChange={() => {}}
        onUrlKeyDown={() => {}}
        onTitleKeyDown={() => {}}
        onRemoveLink={() => {}}
      />,
    );

    expect(Boolean(view.getByLabelText("Page or URL"))).toBe(true);
    expect(Boolean(view.getByLabelText("Link title"))).toBe(true);
  });

  test("renders the compact create-link dialog and invokes submit", async () => {
    let submitted = 0;

    const view = render(
      <NfmCreateLinkDialogSurface
        urlLabel="Page or URL"
        urlPlaceholder="Paste or type a link"
        urlValue="https://community.openai.com/t/example"
        submitLabel="Add link"
        onUrlChange={() => {}}
        onUrlKeyDown={() => {}}
        onSubmit={() => {
          submitted += 1;
        }}
      />,
    );

    expect(Boolean(view.getByLabelText("Page or URL"))).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Add link" }));
      await settleAsyncRender();
    });

    expect(submitted).toBe(1);
  });
});
