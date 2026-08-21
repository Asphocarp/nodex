import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { ProjectAppearance } from "../../../shared/project-appearance";
import { render, settleAsyncRender } from "@/test/dom";
import { ProjectMarker } from "./project-marker";
import { ProjectMarkerPicker } from "./project-marker-picker";

describe("project marker", () => {
  test("renders icon and emoji markers through one canonical surface", () => {
    const view = render(
      <div>
        <ProjectMarker
          data-testid="icon-marker"
          appearance={{
            color: "blue",
            marker: { kind: "icon", icon: "terminal" },
          }}
        />
        <ProjectMarker
          data-testid="emoji-marker"
          appearance={{
            color: "green",
            marker: { kind: "emoji", emoji: "🪴" },
          }}
        />
      </div>,
    );

    expect(
      view.getByTestId("icon-marker").querySelector('[data-project-marker-icon="terminal"]'),
    ).not.toBeNull();
    expect(view.getByTestId("emoji-marker").textContent).toBe("🪴");
  });
});

describe("project marker picker", () => {
  test("preserves an emoji when changing color and replaces it when choosing an icon", async () => {
    const onAppearanceChange = vi.fn();

    function Harness() {
      const [appearance, setAppearance] = useState<ProjectAppearance>({
        color: "green",
        marker: { kind: "emoji", emoji: "🪴" },
      });

      return (
        <ProjectMarkerPicker
          defaultOpen
          portalled={false}
          projectName="Nodex"
          appearance={appearance}
          onAppearanceChange={(nextAppearance) => {
            onAppearanceChange(nextAppearance);
            setAppearance(nextAppearance);
          }}
        />
      );
    }

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Harness />);
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Use Blue" }));
      await settleAsyncRender();
    });

    expect(onAppearanceChange).toHaveBeenLastCalledWith({
      color: "blue",
      marker: { kind: "emoji", emoji: "🪴" },
    });
    expect(view.getByRole("button", { name: "Use Blue" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(view.getByRole("button", { name: "Change marker for Nodex" }).textContent).toBe("🪴");

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Use Terminal" }));
      await settleAsyncRender();
    });

    expect(onAppearanceChange).toHaveBeenLastCalledWith({
      color: "blue",
      marker: { kind: "icon", icon: "terminal" },
    });
    expect(
      view
        .getByRole("button", { name: "Change marker for Nodex" })
        .querySelector('[data-project-marker-icon="terminal"]'),
    ).not.toBeNull();
  });

  test("Done closes the picker", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <ProjectMarkerPicker
          defaultOpen
          portalled={false}
          projectName="Nodex"
          appearance={{
            color: "black",
            marker: { kind: "icon", icon: "folder" },
          }}
          onAppearanceChange={() => undefined}
        />,
      );
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      await settleAsyncRender();
    });

    expect(view.queryByRole("group", { name: "Project color" })).toBeNull();
  });

  test("pending state disables the appearance trigger", () => {
    const view = render(
      <ProjectMarkerPicker
        pending
        projectName="Nodex"
        appearance={{
          color: "black",
          marker: { kind: "icon", icon: "folder" },
        }}
        onAppearanceChange={() => undefined}
      />,
    );

    const trigger = view.getByRole("button", {
      name: "Change marker for Nodex",
    });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(trigger.getAttribute("aria-busy")).toBe("true");
  });
});
