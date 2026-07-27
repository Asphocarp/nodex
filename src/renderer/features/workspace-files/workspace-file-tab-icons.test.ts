import { createElement } from "react";
import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import {
  resolveWorkspaceFileTabIcon,
  resolveWorkspaceFileTabIconKey,
} from "./workspace-file-tab-icons";

describe("resolveWorkspaceFileTabIconKey", () => {
  test.each([
    ["/repo/SKILL.md", "skill"],
    ["/repo/index.ts", "typescript"],
    ["/repo/app.tsx", "react"],
    ["/repo/app.jsx", "react"],
    ["/repo/main.js", "javascript"],
    ["/repo/README.md", "document"],
    ["/repo/package.json", "json"],
    ["/repo/run.sh", "shell"],
    ["/repo/Dockerfile", "terminal"],
    ["/repo/cover.png", "image"],
    ["/repo/Makefile", "build"],
    ["/repo/archive.zip", "folder"],
    ["/repo/LICENSE", "file"],
  ] as const)("maps %s to %s", (path, expected) => {
    expect(resolveWorkspaceFileTabIconKey(path)).toBe(expected);
  });

  test("falls back to MIME types before the generic file icon", () => {
    expect(resolveWorkspaceFileTabIconKey("/repo/cover", "image/webp")).toBe("image");
    expect(resolveWorkspaceFileTabIconKey("/repo/data", "application/pdf")).toBe("pdf");
    expect(resolveWorkspaceFileTabIconKey("/repo/notes", "text/plain")).toBe("document");
    expect(resolveWorkspaceFileTabIconKey("/repo/value", "application/octet-stream")).toBe("file");
  });

  test("recognizes directory paths and empty file tabs", () => {
    expect(resolveWorkspaceFileTabIconKey("/repo/src/")).toBe("folder");
    expect(resolveWorkspaceFileTabIconKey()).toBe("file");
  });

  test("returns stable component identities for the same semantic icon", () => {
    expect(resolveWorkspaceFileTabIcon("/repo/one.ts")).toBe(
      resolveWorkspaceFileTabIcon("/repo/two.ts"),
    );
    expect(resolveWorkspaceFileTabIcon("/repo/one.ts")).not.toBe(
      resolveWorkspaceFileTabIcon("/repo/one.tsx"),
    );
  });

  test("renders the dedicated tab glyph family without file-tree sprites or colors", () => {
    const JavaScriptIcon = resolveWorkspaceFileTabIcon("/repo/index.mjs");
    const view = render(createElement(JavaScriptIcon, { className: "icon-xs" }));
    const svg = view.container.querySelector("svg");
    const path = svg?.querySelector("path");

    expect(svg?.getAttribute("data-file-tab-icon")).toBe("javascript");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg?.getAttribute("style")).toBe(null);
    expect(svg?.querySelector("use")).toBe(null);
    expect(path?.getAttribute("fill")).toBe("currentColor");
    expect(path?.getAttribute("d")?.startsWith("M4.77431 2H11.2257")).toBe(true);
  });

  test("uses the simplified document and generic-file geometries independently", () => {
    const DocumentIcon = resolveWorkspaceFileTabIcon("/repo/README.md");
    const FileIcon = resolveWorkspaceFileTabIcon("/repo/LICENSE");
    const documentView = render(createElement(DocumentIcon));
    const fileView = render(createElement(FileIcon));
    const documentSvg = documentView.container.querySelector("svg");
    const fileSvg = fileView.container.querySelector("svg");

    expect(documentSvg?.getAttribute("data-file-tab-icon")).toBe("document");
    expect(documentSvg?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(documentSvg?.querySelector("path")?.getAttribute("d")?.startsWith("M3.685 13.9927")).toBe(true);
    expect(fileSvg?.getAttribute("data-file-tab-icon")).toBe("file");
    expect(fileSvg?.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(fileSvg?.querySelector("use")).toBe(null);
  });
});
