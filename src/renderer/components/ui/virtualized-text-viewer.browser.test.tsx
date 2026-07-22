import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import "../../globals.css";
import { VirtualizedTextViewer } from "./virtualized-text-viewer";

describe("VirtualizedTextViewer browser behavior", () => {
  test("keeps a 1.5 MB exact source viewport-sized and searchable", async () => {
    const source = "export const fixture = true;\n".repeat(55_556).slice(0, 1_500_000);
    const view = render(
      <div style={{ height: 640, width: 960 }}>
        <VirtualizedTextViewer
          value={source}
          ariaLabel="Large exact source"
          lineNumbers
          className="h-full"
        />
      </div>,
    );

    const content = await view.findByLabelText("Large exact source");
    await waitFor(() => {
      expect(view.container.querySelectorAll(".cm-line").length).toBeGreaterThan(0);
    });
    expect(view.container.getElementsByTagName("*").length).toBeLessThan(2_000);
    expect(content.textContent?.length ?? 0).toBeLessThan(20_000);

    fireEvent.keyDown(content, { key: "f", metaKey: true });
    await waitFor(() => {
      expect(view.container.querySelector(".cm-search input")).not.toBeNull();
    });
  });
});
