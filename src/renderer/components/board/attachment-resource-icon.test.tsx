import { describe, expect, test } from "vite-plus/test";
import { render } from "@/test/dom";
import { AttachmentResourceIcon } from "./attachment-resource-icon";

describe("AttachmentResourceIcon", () => {
  test.each([
    {
      name: "content-skeleton.tsx",
      mimeType: "text/typescript",
      icon: "react",
      colorVariable: "trees-file-icon-color-react",
    },
    {
      name: "result.json",
      mimeType: "application/json",
      icon: "json",
      colorVariable: "trees-file-icon-color-json",
    },
    {
      name: "review.webm",
      mimeType: "video/webm",
      icon: "file",
      colorVariable: "trees-file-icon-color-default",
    },
  ])("keeps the $icon glyph and applies its file-type color", (fixture) => {
    const view = render(
      <AttachmentResourceIcon
        kind="file"
        name={fixture.name}
        mimeType={fixture.mimeType}
        className="size-4"
      />,
    );
    const icon = view.container.querySelector<SVGSVGElement>(
      `[data-file-tab-icon="${fixture.icon}"]`,
    );

    expect(icon).not.toBeNull();
    expect(icon?.style.color).toContain(fixture.colorVariable);
  });
});
