import { createElement } from "react";
import { describe, expect, test } from "vite-plus/test";
import { render } from "@/test/dom";
import {
  FileResourceIcon,
  resolveFileResourceIcon,
  resolveFileResourceIconKey,
} from "./file-resource-icon";

describe("FileResourceIcon", () => {
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
    expect(resolveFileResourceIconKey(path)).toBe(expected);
  });

  test("falls back to MIME types before the generic file icon", () => {
    expect(resolveFileResourceIconKey("/repo/cover", "image/webp")).toBe("image");
    expect(resolveFileResourceIconKey("/repo/data", "application/pdf")).toBe("pdf");
    expect(resolveFileResourceIconKey("/repo/notes", "text/plain")).toBe("document");
    expect(resolveFileResourceIconKey("/repo/value", "application/octet-stream")).toBe("file");
  });

  test("recognizes directory paths and empty file tabs", () => {
    expect(resolveFileResourceIconKey("/repo/src/")).toBe("folder");
    expect(resolveFileResourceIconKey()).toBe("file");
  });

  test("returns stable component identities for the same semantic icon", () => {
    expect(resolveFileResourceIcon("/repo/one.ts")).toBe(resolveFileResourceIcon("/repo/two.ts"));
    expect(resolveFileResourceIcon("/repo/one.ts")).not.toBe(
      resolveFileResourceIcon("/repo/one.tsx"),
    );
  });

  test("renders the dedicated tab glyph family without file-tree sprites or colors", () => {
    const JavaScriptIcon = resolveFileResourceIcon("/repo/index.mjs");
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
    const DocumentIcon = resolveFileResourceIcon("/repo/README.md");
    const FileIcon = resolveFileResourceIcon("/repo/LICENSE");
    const documentView = render(createElement(DocumentIcon));
    const fileView = render(createElement(FileIcon));
    const documentSvg = documentView.container.querySelector("svg");
    const fileSvg = fileView.container.querySelector("svg");

    expect(documentSvg?.getAttribute("data-file-tab-icon")).toBe("document");
    expect(documentSvg?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(
      documentSvg?.querySelector("path")?.getAttribute("d")?.startsWith("M3.685 13.9927"),
    ).toBe(true);
    expect(fileSvg?.getAttribute("data-file-tab-icon")).toBe("file");
    expect(fileSvg?.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(fileSvg?.querySelector("use")).toBe(null);
  });

  test("renders the shared path and MIME projection without exposing resolver details", () => {
    const view = render(
      <FileResourceIcon path="references/report" mimeType="application/pdf" className="size-4" />,
    );

    expect(view.container.querySelector("[data-file-tab-icon='pdf']")).not.toBeNull();
  });
});
