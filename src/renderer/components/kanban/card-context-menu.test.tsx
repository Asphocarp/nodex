import { describe, expect, test } from "vitest";
import { render, textContent } from "@/test/dom";
import { CardContextMenuActionRowContent } from "./card-context-menu-row";
import { getCardActionMenuEntries, type CardActionMenuEntry } from "./card-context-menu-model";

function getAction(id: CardActionMenuEntry["id"], showMockActions: boolean) {
  const action = getCardActionMenuEntries({ query: "", showMockActions })
    .find((entry) => entry.id === id);
  if (!action) {
    throw new Error(`Missing card action ${id}`);
  }

  return action;
}

describe("card context menu action row content", () => {
  test("does not receive reference mock rows from the production menu model", () => {
    const actions = getCardActionMenuEntries({ query: "", showMockActions: false });

    expect(actions.some((action) => action.mockReason !== undefined)).toBe(false);
    expect(actions.map((action) => action.id).join(",")).toBe("copy-link,move-to,delete");
  });

  test("renders dev mock rows with a Mock badge", () => {
    const favorite = getAction("favorite", true);
    const view = render(
      <div role="menuitem" aria-disabled={favorite.disabled ? "true" : undefined}>
        <CardContextMenuActionRowContent entry={favorite} />
      </div>,
    );

    expect(favorite.disabled).toBe(true);
    expect(Boolean(favorite.mockReason)).toBe(true);
    expect(textContent(view.container).includes("Add to Favorites")).toBe(true);
    expect(textContent(view.container).includes("Mock")).toBe(true);
  });
});
