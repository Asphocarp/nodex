import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act, useCallback, useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, settleAsyncRender } from "../../../test/dom";

const deleteLink = () => {};
const editLink = () => {};
const showSelection = () => {};
const formattingToolbarStore = {
  setState: () => {},
};
let createLinkButtonState:
  | {
      url?: string;
      text: string;
      range: {
        from: number;
        to: number;
      };
    }
  | undefined;

mock.module("./nfm-link-toolbar-deps", () => ({
  useFileLinkOpener: () => ({
    opener: () => undefined,
  }),
  writeTextToClipboard: async () => true,
  openNfmResolvedLinkAction: async () => true,
  resolveNfmLinkAction: () => ({
    kind: "web-url",
    href: "https://community.openai.com/t/example",
    url: "https://community.openai.com/t/example",
  }),
  resolveNfmLinkTooltipLabel: () => null,
  useBlockNoteEditor: () => ({
    domElement: null,
    isEditable: true,
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
  useEditorState: () => createLinkButtonState,
  useExtension: () => ({
    deleteLink,
    editLink,
    showSelection,
    store: formattingToolbarStore,
  }),
  NfmCompactLinkToolbar: ({
    editLabel,
    onEditLink,
  }: {
    editLabel: string;
    onEditLink: () => void;
  }) => (
    <div data-testid="nfm-compact-link-toolbar">
      <button type="button" onClick={onEditLink}>{editLabel}</button>
    </div>
  ),
  NfmCreateLinkDialogSurface: () => <div data-testid="nfm-create-link-dialog" />,
  NfmLinkEditDialogSurface: () => <div data-testid="nfm-link-edit-dialog" />,
}));

describe("NfmLinkToolbar", () => {
  test("does not crash when the create-link button becomes unavailable for a node selection", async () => {
    createLinkButtonState = {
      url: "https://example.com",
      text: "Example",
      range: { from: 1, to: 8 },
    };

    const { NfmCreateLinkButton } = await import("./nfm-link-toolbar");

    const view = render(
      <NodexTooltipProvider>
        <NfmCreateLinkButton />
      </NodexTooltipProvider>,
    );

    expect(Boolean(view.getByRole("button", { name: "Add link" }))).toBeTrue();

    createLinkButtonState = undefined;

    await act(async () => {
      view.rerender(
        <NodexTooltipProvider>
          <NfmCreateLinkButton />
        </NodexTooltipProvider>,
      );
      await settleAsyncRender();
    });

    expect(view.queryByRole("button", { name: "Add link" }) === null).toBeTrue();
  });

  test("opens the create-link dialog from a custom render trigger", async () => {
    createLinkButtonState = {
      text: "Example",
      range: { from: 1, to: 8 },
    };

    const { NfmCreateLinkButton } = await import("./nfm-link-toolbar");

    const view = render(
      <NodexTooltipProvider>
        <NfmCreateLinkButton
          renderTrigger={(props) => (
            <button
              type="button"
              aria-label={props.ariaLabel}
              onMouseDown={props.onMouseDown}
              onClick={props.onClick}
            >
              Custom link
            </button>
          )}
        />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Add link" }));
      await settleAsyncRender();
    });

    expect(Boolean(view.getByTestId("nfm-create-link-dialog"))).toBeTrue();
  });

  test("keeps the edit dialog open for the current link after clicking edit", async () => {
    createLinkButtonState = undefined;
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

    expect(Boolean(view.getByTestId("nfm-link-edit-dialog"))).toBeTrue();
    expect(view.queryByTestId("nfm-compact-link-toolbar") === null).toBeTrue();
  });

  test("keeps the edit dialog mounted across parent rerenders when the wrapper component identity is stable", async () => {
    createLinkButtonState = undefined;
    const { NfmLinkToolbar } = await import("./nfm-link-toolbar");

    function Host() {
      const [tick, setTick] = useState(0);
      const ToolbarComponent = useCallback((toolbarProps: {
        url: string;
        text: string;
        range: { from: number; to: number };
        setToolbarOpen: () => void;
        setToolbarPositionFrozen: () => void;
      }) => (
        <NfmLinkToolbar
          {...toolbarProps}
          projectWorkspacePath={null}
        />
      ), []);

      return (
        <NodexTooltipProvider>
          <button type="button" onClick={() => setTick((value) => value + 1)}>
            Rerender {tick}
          </button>
          <ToolbarComponent
            url="https://community.openai.com/t/example"
            text="OpenAI forum note"
            range={{ from: 4, to: 9 }}
            setToolbarOpen={() => {}}
            setToolbarPositionFrozen={() => {}}
          />
        </NodexTooltipProvider>
      );
    }

    const view = render(<Host />);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Edit" }));
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Rerender/ }));
      await settleAsyncRender();
    });

    expect(Boolean(view.getByTestId("nfm-link-edit-dialog"))).toBeTrue();
    expect(view.queryByTestId("nfm-compact-link-toolbar") === null).toBeTrue();
  });
});
