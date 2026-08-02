import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import { FileIcon, PageIcon } from "./app-icons";

describe("file and page identity icons", () => {
  test("share one geometry while preserving semantic component names", () => {
    const fileView = render(<FileIcon />);
    const pageView = render(<PageIcon />);
    const fileSvg = fileView.container.querySelector("svg");
    const pageSvg = pageView.container.querySelector("svg");

    expect(fileSvg?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(pageSvg?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(fileSvg?.querySelector("path")?.getAttribute("d")).toBe(
      pageSvg?.querySelector("path")?.getAttribute("d"),
    );
    expect(fileSvg?.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(fileSvg?.hasAttribute("data-file-page-icon")).toBe(true);
    expect(pageSvg?.getAttribute("aria-hidden")).toBe("true");
  });
});
