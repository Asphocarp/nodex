import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewRaw } from "@blocknote/react";
import { AllSelection } from "@tiptap/pm/state";
import { act, fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { codeBlockViewState } from "@/lib/nfm/code-block-view-state";
import { blockNoteToNfm } from "../../../../shared/block-documents/nfm-blocknote-adapter";
import { serializeNfm } from "../../../../shared/nfm";
import { nfmSchema } from "./nfm-schema";
import { createNfmEditorExtensions } from "./nfm-editor-extensions";
import { NfmCodeBlockController } from "./nfm-code-block-controller";
import { NfmSideMenuOpenProvider } from "./nfm-side-menu";
import { selectCurrentBlockContent } from "./select-block-shortcut";
import "../../../globals.css";

const mountedEditors: BlockNoteEditor<any, any, any>[] = [];
const mountedViews: RenderResult[] = [];

interface RgbaColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

function parseComputedColor(value: string): RgbaColor {
  const channels = value.match(/[\d.]+/gu)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unsupported computed color: ${value}`);
  return {
    red: channels[0]!,
    green: channels[1]!,
    blue: channels[2]!,
    alpha: channels[3] ?? 1,
  };
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  const compositeChannel = (foregroundChannel: number, backgroundChannel: number) =>
    (foregroundChannel * foreground.alpha +
      backgroundChannel * background.alpha * (1 - foreground.alpha)) /
    alpha;
  return {
    red: compositeChannel(foreground.red, background.red),
    green: compositeChannel(foreground.green, background.green),
    blue: compositeChannel(foreground.blue, background.blue),
    alpha,
  };
}

function getPaintedBackground(element: HTMLElement): RgbaColor {
  const layers: RgbaColor[] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    layers.unshift(parseComputedColor(getComputedStyle(current).backgroundColor));
  }
  return layers.reduce((background, layer) => compositeColor(layer, background), {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 1,
  });
}

function relativeLuminance(color: RgbaColor): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    linearize(color.red) * 0.2126 + linearize(color.green) * 0.7152 + linearize(color.blue) * 0.0722
  );
}

function contrastRatio(foreground: RgbaColor, background: RgbaColor): number {
  const paintedForeground = compositeColor(foreground, background);
  const lighter = Math.max(relativeLuminance(paintedForeground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(paintedForeground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const view of mountedViews.splice(0)) view.unmount();
  for (const editor of mountedEditors.splice(0)) editor._tiptapEditor.destroy();
  document.body.replaceChildren();
});

async function mountCodeBlock(
  blockId: string,
  content = "const longValue: string = 'one two three four';",
  theme: "light" | "dark" = "light",
  followingParagraph?: string,
) {
  const editor = BlockNoteEditor.create({
    schema: nfmSchema,
    extensions: createNfmEditorExtensions(),
    initialContent: [
      {
        id: blockId,
        type: "codeBlock",
        props: { language: "typescript" },
        content,
      },
      ...(followingParagraph === undefined
        ? []
        : [{ id: `${blockId}-after`, type: "paragraph" as const, content: followingParagraph }]),
    ],
  });
  mountedEditors.push(editor);
  const view = render(
    <div
      className={
        theme === "dark"
          ? "nfm-editor dark bg-[var(--background)]"
          : "nfm-editor bg-[var(--background)]"
      }
    >
      <BlockNoteViewRaw
        editor={editor}
        theme={theme}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      >
        <NfmSideMenuOpenProvider>
          <NfmCodeBlockController />
        </NfmSideMenuOpenProvider>
      </BlockNoteViewRaw>
    </div>,
  );
  mountedViews.push(view);
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  return { editor, host: view.container };
}

describe("NFM Code Block surface in Chromium", () => {
  test("merges the following paragraph into Code Block source on Backspace", async () => {
    const { editor } = await mountCodeBlock("code-backspace-merge", "alpha", "light", "beta");
    const prosemirrorView = editor.prosemirrorView;
    if (!prosemirrorView) throw new Error("Expected a mounted Code Block editor");

    await act(async () => {
      editor.setTextCursorPosition("code-backspace-merge-after", "start");
      editor.focus();
      fireEvent.keyDown(prosemirrorView.dom, { key: "Backspace", code: "Backspace" });
      await Promise.resolve();
    });

    expect(editor.document).toHaveLength(1);
    expect(editor.document[0]).toMatchObject({
      id: "code-backspace-merge",
      type: "codeBlock",
    });
    expect(editor.document[0].content).toEqual([{ type: "text", text: "alphabeta", styles: {} }]);
    expect(editor.getTextCursorPosition().block.id).toBe("code-backspace-merge");
    expect(editor.prosemirrorState.selection.$anchor.parentOffset).toBe(5);
  });

  test("keeps Backspace at the start of a Code Block as a no-op", async () => {
    const { editor } = await mountCodeBlock("code-backspace-start", "alpha", "light", "after");
    const prosemirrorView = editor.prosemirrorView;
    if (!prosemirrorView) throw new Error("Expected a mounted Code Block editor");
    const before = editor.document;

    await act(async () => {
      editor.setTextCursorPosition("code-backspace-start", "start");
      editor.focus();
      fireEvent.keyDown(prosemirrorView.dom, { key: "Backspace", code: "Backspace" });
      await Promise.resolve();
    });

    expect(editor.document).toEqual(before);
    expect(editor.getTextCursorPosition().block.id).toBe("code-backspace-start");
    expect(editor.prosemirrorState.selection.$anchor.parentOffset).toBe(0);
  });

  test("progressively selects Code Block source before the complete editor", async () => {
    const source = "const alpha = 1;\nconst beta = 2;";
    const { editor } = await mountCodeBlock("code-selection", source, "light", "After");

    await act(async () => {
      editor.setTextCursorPosition("code-selection", "end");
      editor.focus();
      expect(selectCurrentBlockContent(editor)).toBe(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(document.getSelection()?.toString()).toBe(source);

    await act(async () => {
      expect(selectCurrentBlockContent(editor)).toBe(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(editor.prosemirrorState.selection).toBeInstanceOf(AllSelection);
  });

  test("keeps the sole Action Bar mounted for coarse pointer input", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(pointer: coarse)",
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as MediaQueryList,
    );

    await mountCodeBlock("code-coarse-pointer");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(await screen.findByRole("toolbar", { name: "Code block action bar" })).not.toBeNull();
  });

  test("renders a product action anchor without the vanilla language select", async () => {
    const { host } = await mountCodeBlock("code-surface");
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]");
    const anchor = surface?.querySelector<HTMLElement>("[data-nfm-code-block-action-anchor]");

    expect(surface?.dataset.blockId).toBe("code-surface");
    expect(anchor?.contentEditable).toBe("false");
    expect(surface?.querySelector("select")).toBeNull();
  });

  test.each(["light", "dark"] as const)(
    "keeps %s syntax tokens readable against the painted Code Block surface",
    async (theme) => {
      const { host } = await mountCodeBlock(`code-contrast-${theme}`, undefined, theme);
      const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;
      const blockContent = surface.closest<HTMLElement>(
        '.bn-block-content[data-content-type="codeBlock"]',
      )!;
      const code = surface.querySelector<HTMLElement>("code")!;
      const punctuationToken = await waitFor(() => {
        const token = [...code.querySelectorAll<HTMLElement>("span")].find((candidate) =>
          candidate.textContent?.includes(";"),
        );
        if (!token) throw new Error("Shiki punctuation token did not render");
        return token;
      });
      const background = getPaintedBackground(surface);
      const foreground = parseComputedColor(getComputedStyle(punctuationToken).color);
      const ratio = contrastRatio(foreground, background);

      expect(getComputedStyle(blockContent).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(
        ratio,
        `${theme} Code Block contrast: ${JSON.stringify({ foreground, background, ratio })}`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each(["light", "dark"] as const)(
    "matches the Action Bar chrome and controls to the %s Code Block scheme",
    async (theme) => {
      const { host } = await mountCodeBlock(`code-action-theme-${theme}`, undefined, theme);
      const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;
      fireEvent.pointerOver(surface);
      const actionBar = await screen.findByRole("toolbar", { name: "Code block action bar" });
      const moreButton = screen.getByRole("button", { name: "Open block actions menu" });
      const background = parseComputedColor(getComputedStyle(actionBar).backgroundColor);
      const controlForeground = parseComputedColor(getComputedStyle(moreButton).color);
      const luminance = relativeLuminance(background);

      if (theme === "dark") {
        expect(luminance).toBeLessThan(0.1);
      } else {
        expect(luminance).toBeGreaterThan(0.8);
      }
      expect(contrastRatio(controlForeground, background)).toBeGreaterThanOrEqual(3);
    },
  );

  test("projects local wrap state without changing the Block document", async () => {
    const { editor, host } = await mountCodeBlock("code-wrap-local");
    const before = editor.document;
    const nfmBefore = serializeNfm(blockNoteToNfm(before));
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;
    const code = surface.querySelector<HTMLElement>("code")!;
    expect(surface.dataset.wrapped).toBe("false");
    expect(getComputedStyle(code).whiteSpace).toBe("pre");

    await act(async () => {
      codeBlockViewState.setWrapped("code-wrap-local", true);
    });

    expect(surface.dataset.wrapped).toBe("true");
    expect(getComputedStyle(code).whiteSpace).toBe("break-spaces");
    expect(editor.document).toEqual(before);
    expect(serializeNfm(blockNoteToNfm(editor.document))).toBe(nfmBefore);
    expect(editor.getBlock("code-wrap-local")?.props).not.toHaveProperty("wrapped");
  });

  test("starts duplicated blocks with an independent nowrap state", async () => {
    const originalId = "code-wrap-identity";
    const { editor, host } = await mountCodeBlock(originalId);
    const originalSurface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;

    await act(async () => codeBlockViewState.setWrapped(originalId, true));
    fireEvent.pointerOver(originalSurface);
    fireEvent.click(screen.getByRole("button", { name: "Open block actions menu" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Duplicate/ }));

    await waitFor(() => expect(editor.document).toHaveLength(2));
    const duplicate = editor.document.find((block) => block.id !== originalId)!;
    expect(duplicate.type).toBe("codeBlock");
    expect(codeBlockViewState.getWrapped(duplicate.id)).toBe(false);
    expect(codeBlockViewState.getWrapped(originalId)).toBe(true);
  });

  test("restores wrap when delete and undo restore the same block identity", async () => {
    const originalId = "code-wrap-delete-undo";
    const { editor } = await mountCodeBlock(originalId);

    await act(async () => {
      codeBlockViewState.setWrapped(originalId, true);
      editor.removeBlocks([originalId]);
      expect(editor.undo()).toBe(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(editor.getBlock(originalId)?.type).toBe("codeBlock"));
    expect(codeBlockViewState.getWrapped(originalId)).toBe(true);
  });

  test("mounts one Action Bar for hover, changes language, and hides it while dragging", async () => {
    const { editor, host } = await mountCodeBlock("code-actions");
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;
    expect(editor.domElement?.contains(surface)).toBe(true);
    expect(screen.queryByRole("toolbar", { name: "Code block action bar" })).toBeNull();

    await act(async () => {
      surface.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, composed: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(screen.getByRole("toolbar", { name: "Code block action bar" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open language dropdown" }));
    fireEvent.click(screen.getByRole("option", { name: "Python" }));
    expect((editor.getBlock("code-actions")?.props as { language?: unknown }).language).toBe(
      "python",
    );

    await act(async () => {
      fireEvent.dragStart(surface);
    });
    expect(screen.queryByRole("toolbar", { name: "Code block action bar" })).toBeNull();
  });

  test("routes narrow-bar capabilities through More without persisting wrap", async () => {
    const { editor, host } = await mountCodeBlock("code-more-actions");
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;
    const before = editor.document;

    await act(async () => {
      fireEvent.pointerOver(surface);
    });
    fireEvent.click(screen.getByRole("button", { name: "Open block actions menu" }));

    expect(await screen.findByRole("option", { name: "Copy code" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Wrap code" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Language" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Format code" })).not.toBeNull();
    expect(screen.queryByText(/caption/iu)).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: "Wrap code" }));
    await waitFor(() => expect(surface.dataset.wrapped).toBe("true"));
    expect(editor.document).toEqual(before);

    fireEvent.click(screen.getByRole("option", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Python" }));
    expect((editor.getBlock("code-more-actions")?.props as { language?: unknown }).language).toBe(
      "python",
    );
  });

  test("returns from More to the Action Bar and can open Language next", async () => {
    const { host } = await mountCodeBlock("code-menu-handoff");
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;

    fireEvent.pointerOver(surface);
    fireEvent.click(screen.getByRole("button", { name: "Open block actions menu" }));
    expect(await screen.findByRole("dialog", { name: "Block actions" })).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByRole("dialog", { name: "Block actions" })).toBeNull();

    fireEvent.pointerOver(surface);
    fireEvent.click(screen.getByRole("button", { name: "Open language dropdown" }));
    expect(await screen.findByRole("listbox", { name: "Code language" })).not.toBeNull();
  });

  test("returns from Language selection to the Action Bar and can open More next", async () => {
    const { host } = await mountCodeBlock("code-language-handoff");
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;

    fireEvent.pointerOver(surface);
    fireEvent.click(screen.getByRole("button", { name: "Open language dropdown" }));
    fireEvent.click(await screen.findByRole("option", { name: "Python" }));
    await waitFor(() => expect(surface.dataset.language).toBe("python"));

    fireEvent.pointerOver(surface);
    fireEvent.click(screen.getByRole("button", { name: "Open block actions menu" }));
    expect(await screen.findByRole("dialog", { name: "Block actions" })).not.toBeNull();
  });

  test("formats in one editor transaction and restores source with one undo", async () => {
    const source = "const answer:number=42";
    const { editor, host } = await mountCodeBlock("code-format-action", source);
    const surface = host.querySelector<HTMLElement>("[data-nfm-code-block-surface]")!;

    await act(async () => {
      fireEvent.pointerOver(surface);
    });
    fireEvent.click(screen.getByRole("button", { name: "Open block actions menu" }));
    fireEvent.click(await screen.findByRole("option", { name: "Format code" }));

    await waitFor(() => {
      expect(editor.getBlock("code-format-action")?.content).toEqual([
        { type: "text", text: "const answer: number = 42;", styles: {} },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Block actions" })).toBeNull();
    });
    await act(async () => {
      expect(editor.undo()).toBe(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(editor.getBlock("code-format-action")?.content).toEqual([
        { type: "text", text: source, styles: {} },
      ]);
    });
  });
});
