import { describe, expect, test } from "vite-plus/test";
import { editorCodeBlockOptions } from "./code-block-options";
import { codeLanguagePreference } from "@/lib/nfm/code-language-preference";

const shikiParserSymbol = Symbol.for("blocknote.shikiParser");
const shikiHighlighterPromiseSymbol = Symbol.for("blocknote.shikiHighlighterPromise");

type GlobalThisWithBlockNoteShiki = typeof globalThis & {
  [shikiParserSymbol]?: unknown;
  [shikiHighlighterPromiseSymbol]?: unknown;
};

function clearBlockNoteShikiState(): void {
  const globalState = globalThis as GlobalThisWithBlockNoteShiki;
  delete globalState[shikiParserSymbol];
  delete globalState[shikiHighlighterPromiseSymbol];
}

describe("editorCodeBlockOptions", () => {
  test("offers exactly the shared 88-language product catalog", () => {
    const names = Object.values(editorCodeBlockOptions.supportedLanguages ?? {}).map(
      ({ name }) => name,
    );

    expect(names).toHaveLength(88);
    expect(names.at(0)).toBe("ABAP");
    expect(names.at(-1)).toBe("YAML");
    expect(names).toContain("Rocq");
    expect(names).not.toContain("Vue");
  });

  test("reads the validated recent language only when a new block asks for a default", () => {
    codeLanguagePreference.set("Python");
    try {
      expect(editorCodeBlockOptions.defaultLanguage).toBe("text");
      expect(editorCodeBlockOptions.getDefaultLanguage?.()).toBe("python");
    } finally {
      codeLanguagePreference.set("text");
    }
  });

  test("seeds a dual-theme BlockNote parser for light and dark code blocks", async () => {
    clearBlockNoteShikiState();
    try {
      const createHighlighter = editorCodeBlockOptions.createHighlighter;
      if (!createHighlighter) {
        throw new Error("Expected editor code block options to provide a highlighter.");
      }

      const highlighter = await createHighlighter();
      await highlighter.loadLanguage("typescript");

      const parser = (globalThis as GlobalThisWithBlockNoteShiki)[shikiParserSymbol];

      expect(typeof parser === "function").toBe(true);
      if (typeof parser !== "function") return;

      const content = "const answer = 42";
      const decorations = parser({
        content,
        language: "typescript",
        pos: 0,
        size: content.length + 2,
      });

      expect(Array.isArray(decorations)).toBe(true);
      if (!Array.isArray(decorations)) return;

      const rootStyle = String(decorations[0]?.type?.attrs?.style ?? "");
      const tokenStyle = String(decorations[1]?.type?.attrs?.style ?? "");

      expect(rootStyle.includes("--shiki-dark")).toBe(true);
      expect(tokenStyle.includes("--shiki-dark")).toBe(true);
    } finally {
      clearBlockNoteShikiState();
    }
  });
});
