import { describe, expect, test } from "vitest";
import {
  getFileTreeIconColor,
  resolveFileTreeIcon,
  resolveFileTreeIconToken,
} from "./file-tree-icons";

describe("file tree icons", () => {
  test("resolves core source file types to file-tree tokens", () => {
    expect(resolveFileTreeIconToken("src/example.ts")).toBe("typescript");
    expect(resolveFileTreeIconToken("src/example.tsx")).toBe("react");
    expect(resolveFileTreeIconToken("src/example.jsx")).toBe("react");
    expect(resolveFileTreeIconToken("docs/README.md")).toBe("markdown");
    expect(resolveFileTreeIconToken("package.json")).toBe("npm");
    expect(resolveFileTreeIconToken("unknown/no-extension")).toBe("default");
  });

  test("resolves config and tool files to file-tree tokens", () => {
    expect(resolveFileTreeIconToken("Dockerfile")).toBe("docker");
    expect(resolveFileTreeIconToken(".gitignore")).toBe("git");
    expect(resolveFileTreeIconToken("next.config.ts")).toBe("nextjs");
    expect(resolveFileTreeIconToken("stylelint.config.js")).toBe("stylelint");
    expect(resolveFileTreeIconToken("tailwind.config.ts")).toBe("tailwind");
    expect(resolveFileTreeIconToken("vite.config.ts")).toBe("vite");
    expect(resolveFileTreeIconToken("eslint.config.mjs")).toBe("eslint");
    expect(resolveFileTreeIconToken("src/styles/app.css")).toBe("css");
    expect(resolveFileTreeIconToken("data/query.graphql")).toBe("graphql");
    expect(resolveFileTreeIconToken("assets/logo.svg")).toBe("svg");
    expect(resolveFileTreeIconToken("docs/table.csv")).toBe("table");
  });

  test("returns sprite symbol names with file-tree ids", () => {
    const icon = resolveFileTreeIcon("src/workbench.tsx");

    expect(icon.token).toBe("react");
    expect(icon.name).toBe("file-tree-builtin-react");
    expect(icon.viewBox).toBe("0 0 16 16");
  });

  test("builds file-tree color fallback variable chains", () => {
    expect(getFileTreeIconColor("typescript")).toBe(
      "var(--trees-file-icon-color-typescript, var(--trees-file-icon-color, light-dark(#1a85d4, #69b1ff)))",
    );
    expect(getFileTreeIconColor("react")).toBe(
      "var(--trees-file-icon-color-react, var(--trees-file-icon-color, light-dark(#1ca1c7, #68cdf2)))",
    );
    expect(getFileTreeIconColor("markdown")).toBe(
      "var(--trees-file-icon-color-markdown, var(--trees-file-icon-color, light-dark(#199f43, #5ecc71)))",
    );
    expect(getFileTreeIconColor("nextjs")).toBe("var(--color-token-text-tertiary)");
    expect(getFileTreeIconColor("stylelint")).toBe("var(--color-token-text-tertiary)");
  });
});
