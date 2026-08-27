import katex from "katex";

const secureKatexOptions = {
  trust: false,
  strict: "error",
  maxExpand: 1_000,
  globalGroup: false,
} as const;

export const latexToHTMLString = (
  latex: string,
  inline = false,
  external = false,
) => {
  try {
    return {
      htmlString: katex.renderToString(latex, {
        throwOnError: true,
        displayMode: !inline,
        output: external ? "mathml" : "htmlAndMathml",
        ...secureKatexOptions,
      }),
      error: undefined,
    };
  } catch (error) {
    return {
      htmlString: katex.renderToString(latex, {
        throwOnError: false,
        displayMode: !inline,
        output: external ? "mathml" : "htmlAndMathml",
        ...secureKatexOptions,
      }),
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
