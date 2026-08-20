import { parseSync, type Program } from "oxc-parser";

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

/** Parse repository TypeScript without depending on TypeScript's unstable compiler API. */
export function parseTypeScriptSource(path: string, sourceText: string): Program {
  const result = parseSync(path, sourceText, {
    astType: "ts",
    lang: path.endsWith(".d.ts") ? "dts" : path.endsWith(".tsx") ? "tsx" : "ts",
    sourceType: "module",
  });
  const errors = result.errors.filter((error) => error.severity === "Error");
  if (errors.length === 0) return result.program;

  throw new Error([
    `Unable to parse ${path}:`,
    ...errors.map((error) => error.codeframe ?? error.message),
  ].join("\n"));
}

/** Convert a zero-based source offset into the one-based location used by diagnostics. */
export function sourcePosition(sourceText: string, offset: number): SourcePosition {
  const beforeOffset = sourceText.slice(0, offset);
  const lastLineBreak = beforeOffset.lastIndexOf("\n");
  return {
    line: beforeOffset.split("\n").length,
    column: offset - lastLineBreak,
  };
}
