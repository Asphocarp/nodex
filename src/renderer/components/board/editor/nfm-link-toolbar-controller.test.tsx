import { beforeEach, describe, expect, vi, test } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { render, settleAsyncRender } from "../../../test/dom";

const editorDomElement = document.createElement("div");
const anchorElement = document.createElement("a");

let selectionChangeCallback: (() => void) | undefined;
let changeCallback: (() => void) | undefined;
let currentSelectionLink:
  | {
      mark: { attrs: { href: string } };
      text: string;
      range: { from: number; to: number };
    }
  | undefined;
let currentHoveredLink:
  | {
      mark: { attrs: { href: string } };
      text: string;
      range: { from: number; to: number };
    }
  | undefined;
let latestPortalElement: HTMLElement | null | undefined;
let latestFloatingStrategy: unknown;

vi.mock("./nfm-link-toolbar-controller-deps", () => ({
  useBlockNoteEditor: () => ({
    domElement: editorDomElement,
    isEditable: true,
    focus: () => undefined,
    onChange: (callback: () => void) => {
      changeCallback = callback;
      return () => {
        if (changeCallback === callback) changeCallback = undefined;
      };
    },
    onSelectionChange: (callback: () => void) => {
      selectionChangeCallback = callback;
      return () => {
        if (selectionChangeCallback === callback) selectionChangeCallback = undefined;
      };
    },
  }),
  useExtension: () => ({
    getLinkAtSelection: () => currentSelectionLink,
    getLinkAtElement: () => currentHoveredLink,
    getLinkElementAtPos: () => anchorElement,
  }),
  NfmFloatingPopover: ({
    children,
    portalElement,
    useFloatingOptions,
  }: {
    children: ReactNode;
    portalElement?: HTMLElement | null;
    useFloatingOptions?: { strategy?: unknown };
  }) => {
    latestPortalElement = portalElement;
    latestFloatingStrategy = useFloatingOptions?.strategy;
    return <div data-testid="nfm-floating-popover">{children}</div>;
  },
}));

function makeSelectionLink(href: string, text: string, from: number, to: number) {
  return {
    mark: {
      attrs: {
        href,
      },
    },
    text,
    range: { from, to },
  };
}

beforeEach(() => {
  selectionChangeCallback = undefined;
  changeCallback = undefined;
  currentSelectionLink = undefined;
  currentHoveredLink = undefined;
  latestPortalElement = undefined;
  latestFloatingStrategy = undefined;
  anchorElement.href = "https://community.openai.com/t/example";
});

describe("NfmLinkToolbarController", () => {
  test("uses the shared body portal and fixed positioning by default", async () => {
    const { NfmLinkToolbarController } = await import("./nfm-link-toolbar-controller");

    render(<NfmLinkToolbarController linkToolbar={() => null} />);

    expect(latestPortalElement).toBeNull();
    expect(latestFloatingStrategy).toBe("fixed");
  });

  test("keeps the current link snapshot mounted while the toolbar is frozen", async () => {
    currentSelectionLink = makeSelectionLink(
      "https://community.openai.com/t/example",
      "OpenAI forum note",
      4,
      9,
    );

    const { NfmLinkToolbarController } = await import("./nfm-link-toolbar-controller");

    const view = render(
      <NfmLinkToolbarController
        linkToolbar={(props) => (
          <div data-testid="toolbar">
            <span>{props.url}</span>
            <button
              type="button"
              onClick={() => {
                props.setToolbarPositionFrozen?.(true);
              }}
            >
              Freeze
            </button>
          </div>
        )}
      />,
    );

    await act(async () => {
      selectionChangeCallback?.();
      await settleAsyncRender();
    });

    expect(Boolean(view.getByTestId("toolbar"))).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Freeze" }));
      await settleAsyncRender();
    });

    currentSelectionLink = undefined;

    await act(async () => {
      selectionChangeCallback?.();
      changeCallback?.();
      await settleAsyncRender();
    });

    expect(Boolean(view.getByTestId("toolbar"))).toBe(true);
    expect(
      view.getByText("https://community.openai.com/t/example", { exact: true }).textContent,
    ).toBe("https://community.openai.com/t/example");
  });

  test("does not retarget the frozen snapshot when editor selection changes", async () => {
    currentSelectionLink = makeSelectionLink(
      "https://community.openai.com/t/example",
      "OpenAI forum note",
      4,
      9,
    );

    const { NfmLinkToolbarController } = await import("./nfm-link-toolbar-controller");

    const view = render(
      <NfmLinkToolbarController
        linkToolbar={(props) => (
          <div data-testid="toolbar">
            <span>{props.url}</span>
            <button
              type="button"
              onClick={() => {
                props.setToolbarPositionFrozen?.(true);
              }}
            >
              Freeze
            </button>
          </div>
        )}
      />,
    );

    await act(async () => {
      selectionChangeCallback?.();
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Freeze" }));
      await settleAsyncRender();
    });

    currentSelectionLink = makeSelectionLink("https://example.com/changed", "Changed link", 20, 27);

    await act(async () => {
      selectionChangeCallback?.();
      changeCallback?.();
      await settleAsyncRender();
    });

    expect(
      view.getByText("https://community.openai.com/t/example", { exact: true }).textContent,
    ).toBe("https://community.openai.com/t/example");
    expect(view.queryByText("https://example.com/changed", { exact: true })).toBeNull();
  });

  test("clears the toolbar when the editor loses the selected link without freezing", async () => {
    currentSelectionLink = makeSelectionLink(
      "https://community.openai.com/t/example",
      "OpenAI forum note",
      4,
      9,
    );

    const { NfmLinkToolbarController } = await import("./nfm-link-toolbar-controller");

    const view = render(
      <NfmLinkToolbarController
        linkToolbar={(props) => <div data-testid="toolbar">{props.url}</div>}
      />,
    );

    await act(async () => {
      selectionChangeCallback?.();
      await settleAsyncRender();
    });

    expect(Boolean(view.getByTestId("toolbar"))).toBe(true);

    currentSelectionLink = undefined;

    await act(async () => {
      selectionChangeCallback?.();
      changeCallback?.();
      await settleAsyncRender();
    });

    expect(view.queryByTestId("toolbar") === null).toBe(true);
  });
});
