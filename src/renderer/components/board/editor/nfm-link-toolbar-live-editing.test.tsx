import { describe, expect, vi, test } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, settleAsyncRender } from "../../../test/dom";

const insertCalls: Array<{ text: string; from: number; to: number }> = [];
const markCalls: Array<{ from: number; to: number; href: string }> = [];
const clipboardWrites: string[] = [];
let focusCalls = 0;

vi.mock("./nfm-link-toolbar-deps", () => ({
  useFileLinkOpener: () => ({
    opener: () => undefined,
  }),
  writeTextToClipboard: async (text: string) => {
    clipboardWrites.push(text);
    return true;
  },
  useBlockNoteEditor: () => ({
    domElement: null,
    isEditable: true,
    focus: () => {
      focusCalls += 1;
    },
    transact: <T,>(
      fn: (tr: {
        doc: {
          type: {
            schema: {
              marks: {
                link: {
                  create: (attrs: { href: string }) => { href: string };
                };
              };
            };
          };
        };
        insertText: (text: string, from: number, to: number) => void;
        addMark: (from: number, to: number, mark: { href: string }) => void;
      }) => T,
    ) =>
      fn({
        doc: {
          type: {
            schema: {
              marks: {
                link: {
                  create: (attrs: { href: string }) => attrs,
                },
              },
            },
          },
        },
        insertText: (text: string, from: number, to: number) => {
          insertCalls.push({ text, from, to });
        },
        addMark: (from: number, to: number, mark: { href: string }) => {
          markCalls.push({ from, to, href: mark.href });
        },
      }),
  }),
  useComponentsContext: () => null,
  useDictionary: () => ({
    formatting_toolbar: {
      link: {
        tooltip: "Add link",
        secondary_tooltip: "Ctrl+K",
      },
    },
    generic: {
      ctrl_shortcut: "Ctrl",
    },
    link_toolbar: {
      open: {
        tooltip: "Open in new tab",
      },
      edit: {
        tooltip: "Edit",
      },
      form: {
        url_placeholder: "Paste or type a link",
        title_placeholder: "Link title",
      },
      delete: {
        tooltip: "Remove link",
      },
    },
  }),
  useEditorState: () => undefined,
  useExtension: () => ({
    deleteLink: () => {},
    editLink: () => {},
  }),
  openNfmResolvedLinkAction: async () => undefined,
  resolveNfmLinkAction: () => ({
    kind: "external-url",
  }),
  resolveNfmLinkTooltipLabel: () => "Open in new tab",
  NfmCompactLinkToolbar: ({
    copyLabel,
    copyState,
    copiedLabel,
    onCopyLink,
    onEditLink,
  }: {
    copyLabel: string;
    copiedLabel: string;
    copyState?: "idle" | "copied";
    onCopyLink: () => void;
    onEditLink: () => void;
  }) => (
    <div>
      <button type="button" onClick={onEditLink}>
        Edit
      </button>
      <button type="button" onClick={onCopyLink}>
        {copyState === "copied" ? copiedLabel : copyLabel}
      </button>
    </div>
  ),
  NfmLinkEditToolbarSurface: ({ onUrlChange }: { onUrlChange: (value: string) => void }) => (
    <div data-testid="nfm-link-edit-toolbar">
      <input aria-label="Type or paste a link" defaultValue="" />
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
          onUrlChange("  https://example.com/next  ");
        }}
      >
        Change URL
      </button>
    </div>
  ),
  NfmCreateLinkDialogSurface: () => <div data-testid="nfm-create-link-dialog" />,
}));

describe("NfmLinkToolbar live editing", () => {
  test("copies the stored href and switches the copy button into copied state", async () => {
    clipboardWrites.length = 0;

    const { NfmLinkToolbar } = await import("./nfm-link-toolbar");

    const view = render(
      <NodexTooltipProvider>
        <NfmLinkToolbar
          url="https://community.openai.com/t/example"
          text="OpenAI forum note"
          range={{ from: 4, to: 9 }}
          setToolbarOpen={() => {}}
          setToolbarPositionFrozen={() => {}}
          projectWorkspacePath={null}
        />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy" }));
      await settleAsyncRender();
    });

    expect(clipboardWrites[0]).toBe("https://community.openai.com/t/example");
    expect(Boolean(view.getByRole("button", { name: "Copied" }))).toBe(true);
  });

  test("updates the editor on every URL change without stealing focus from the toolbar", async () => {
    insertCalls.length = 0;
    markCalls.length = 0;
    focusCalls = 0;

    const { NfmLinkToolbar } = await import("./nfm-link-toolbar");

    const view = render(
      <NodexTooltipProvider>
        <NfmLinkToolbar
          url="https://community.openai.com/t/example"
          text="OpenAI forum note"
          range={{ from: 4, to: 9 }}
          setToolbarOpen={() => {}}
          setToolbarPositionFrozen={() => {}}
          projectWorkspacePath={null}
        />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Edit" }));
      await settleAsyncRender();
    });

    const focusProbe = view.getByRole("textbox", {
      name: "Type or paste a link",
    }) as HTMLInputElement;
    focusProbe.focus();

    await act(async () => {
      fireEvent.mouseDown(view.getByRole("button", { name: "Change URL" }));
      await settleAsyncRender();
    });

    expect(insertCalls[0]?.text).toBe("OpenAI forum note");
    expect(insertCalls[0]?.from).toBe(4);
    expect(insertCalls[0]?.to).toBe(9);
    expect(markCalls[0]?.href).toBe("https://example.com/next");
    expect(markCalls[0]?.to).toBe(21);
    expect(focusCalls).toBe(0);
    expect(document.activeElement === focusProbe).toBe(true);
    expect(Boolean(view.getByTestId("nfm-link-edit-toolbar"))).toBe(true);
    expect(insertCalls[1]).toBeUndefined();
  });
});
