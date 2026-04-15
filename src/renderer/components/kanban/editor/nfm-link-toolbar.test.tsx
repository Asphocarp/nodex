import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act, useCallback, useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, settleAsyncRender } from "../../../test/dom";

const deleteLink = () => {};

mock.module("@/lib/use-file-link-opener", () => ({
  useFileLinkOpener: () => ({
    opener: () => undefined,
  }),
}));

mock.module("@/lib/nfm-link-actions", () => ({
  openNfmResolvedLinkAction: async () => undefined,
  resolveNfmLinkAction: () => ({
    kind: "external-url",
  }),
  resolveNfmLinkTooltipLabel: () => "Open in new tab",
}));

mock.module("@blocknote/react", () => ({
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
  useEditorState: () => undefined,
  useExtension: () => ({
    deleteLink,
  }),
}));

describe("NfmLinkToolbar", () => {
  test("keeps the edit dialog open for the current link after clicking edit", async () => {
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
