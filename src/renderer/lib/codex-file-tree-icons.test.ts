import { describe, expect, test } from "vitest";
import {
  getCodexFileTreeIconColor,
  resolveCodexFileTreeIcon,
  resolveCodexFileTreeIconToken,
} from "./codex-file-tree-icons";

describe("codex file tree icons", () => {
  test("resolves core source file types to Codex tokens", () => {
    expect(resolveCodexFileTreeIconToken("src/example.ts")).toBe("typescript");
    expect(resolveCodexFileTreeIconToken("src/example.tsx")).toBe("react");
    expect(resolveCodexFileTreeIconToken("src/example.jsx")).toBe("react");
    expect(resolveCodexFileTreeIconToken("docs/README.md")).toBe("markdown");
    expect(resolveCodexFileTreeIconToken("package.json")).toBe("npm");
    expect(resolveCodexFileTreeIconToken("unknown/no-extension")).toBe("default");
  });

  test("resolves config and tool files to Codex tokens", () => {
    expect(resolveCodexFileTreeIconToken("Dockerfile")).toBe("docker");
    expect(resolveCodexFileTreeIconToken(".gitignore")).toBe("git");
    expect(resolveCodexFileTreeIconToken("next.config.ts")).toBe("nextjs");
    expect(resolveCodexFileTreeIconToken("stylelint.config.js")).toBe("stylelint");
    expect(resolveCodexFileTreeIconToken("tailwind.config.ts")).toBe("tailwind");
    expect(resolveCodexFileTreeIconToken("vite.config.ts")).toBe("vite");
    expect(resolveCodexFileTreeIconToken("eslint.config.mjs")).toBe("eslint");
    expect(resolveCodexFileTreeIconToken("src/styles/app.css")).toBe("css");
    expect(resolveCodexFileTreeIconToken("data/query.graphql")).toBe("graphql");
    expect(resolveCodexFileTreeIconToken("assets/logo.svg")).toBe("svg");
    expect(resolveCodexFileTreeIconToken("docs/table.csv")).toBe("table");
  });

  test("returns sprite symbol names with Codex ids", () => {
    const icon = resolveCodexFileTreeIcon("src/workbench.tsx");

    expect(icon.token).toBe("react");
    expect(icon.name).toBe("file-tree-builtin-react");
    expect(icon.viewBox).toBe("0 0 16 16");
  });

  test("builds Codex color fallback variable chains", () => {
    expect(getCodexFileTreeIconColor("typescript")).toBe("var(--trees-file-icon-color-typescript, var(--trees-file-icon-color, light-dark(#1a85d4, #69b1ff)))");
    expect(getCodexFileTreeIconColor("react")).toBe("var(--trees-file-icon-color-react, var(--trees-file-icon-color, light-dark(#1ca1c7, #68cdf2)))");
    expect(getCodexFileTreeIconColor("markdown")).toBe("var(--trees-file-icon-color-markdown, var(--trees-file-icon-color, light-dark(#199f43, #5ecc71)))");
    expect(getCodexFileTreeIconColor("nextjs")).toBe("var(--color-token-text-tertiary)");
    expect(getCodexFileTreeIconColor("stylelint")).toBe("var(--color-token-text-tertiary)");
  });
});
