import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@/test/dom";
import { ExpandedSlashCommandDialog } from "./expanded-slash-command-dialog";
import type { ComposerSlashCommand } from "./slash-command-types";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function command(id: string, title: string): ComposerSlashCommand {
  return {
    id,
    title,
    group: "Commands",
    icon: null,
  };
}

describe("ExpandedSlashCommandDialog", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      return;
    }
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  test("derives a valid highlight and preserves pointer intent across command recomputes", async () => {
    const view = render(
      <ExpandedSlashCommandDialog
        commands={[command("compact", "Compact"), command("model", "Model")]}
        composerText=""
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    const compactRow = view.container.querySelector('[data-slash-command-row="compact"]');
    const modelRow = view.container.querySelector('[data-slash-command-row="model"]');
    if (!(compactRow instanceof HTMLElement) || !(modelRow instanceof HTMLElement)) {
      throw new Error("Expected slash command rows");
    }
    expect(compactRow.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      fireEvent.mouseMove(modelRow);
      await Promise.resolve();
    });
    expect(modelRow.getAttribute("aria-selected")).toBe("true");

    view.rerender(
      <ExpandedSlashCommandDialog
        commands={[command("compact", "Compact"), command("model", "Model")]}
        composerText="updated"
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    const recomputedModelRow = view.container.querySelector('[data-slash-command-row="model"]');
    expect(recomputedModelRow?.getAttribute("aria-selected")).toBe("true");
  });
});
