import { describe, expect, test } from "bun:test";
import {
  HeaderAction,
  HeaderActionProvider,
  HeaderShellSlot,
  collectHeaderActions,
} from "./workbench-header-actions";
import { render, settleAsyncRender, textContent } from "@/test/dom";

function LaterActionDeclaration() {
  return (
    <HeaderAction actionId="third" slotPosition="right" align="end" order={30}>
      <button type="button">Third</button>
    </HeaderAction>
  );
}

function EarlierActionDeclaration() {
  return (
    <HeaderAction actionId="first" slotPosition="right" align="end" order={10}>
      <button type="button">First</button>
    </HeaderAction>
  );
}

function MiddleActionDeclaration() {
  return (
    <HeaderAction actionId="second" slotPosition="right" align="end" order={20}>
      <button type="button">Second</button>
    </HeaderAction>
  );
}

describe("workbench header actions", () => {
  test("sorts actions by order then action id with duplicate ids using the last declaration", () => {
    const entries = collectHeaderActions(
      <>
        <HeaderAction actionId="beta" slotPosition="right" align="end" order={20}>
          Old beta
        </HeaderAction>
        <HeaderAction actionId="alpha" slotPosition="right" align="end" order={10}>
          Alpha
        </HeaderAction>
        <HeaderAction actionId="beta" slotPosition="right" align="end" order={20}>
          New beta
        </HeaderAction>
        <HeaderAction actionId="gamma" slotPosition="left" align="start" order={20}>
          Gamma
        </HeaderAction>
      </>,
    );

    expect(entries.map((entry) => entry.actionId).join(",")).toBe("alpha,beta,gamma");
    expect(String(entries.find((entry) => entry.actionId === "beta")?.children)).toBe("New beta");
  });

  test("renders separate declaration components into one right-side rail", async () => {
    const measuredWidths: number[] = [];
    const measuredRailWidths: number[] = [];
    const view = render(
      <HeaderActionProvider
        actions={(
          <>
            <LaterActionDeclaration />
            <EarlierActionDeclaration />
            <MiddleActionDeclaration />
          </>
        )}
      >
        <HeaderShellSlot
          side="right"
          slotWidth={144}
          minWidth={70}
          fallbackWidth={70}
          fallbackRailWidth={62}
          onMeasuredWidthChange={(width) => {
            measuredWidths.push(width);
          }}
          onMeasuredRailWidthChange={(width) => {
            measuredRailWidths.push(width);
          }}
        />
      </HeaderActionProvider>,
    );

    await settleAsyncRender();

    const slot = view.container.querySelector('[data-test-id="header-shell-slot"]');
    const rail = slot?.querySelector('[data-workbench-header-action-rail="visible"]');
    if (!(slot instanceof HTMLElement) || !(rail instanceof HTMLElement)) {
      throw new Error("Expected visible header shell slot");
    }

    const firstActionWrapper = rail.children.item(0);
    if (!(firstActionWrapper instanceof HTMLElement)) {
      throw new Error("Expected first action wrapper");
    }

    expect(slot.className.includes("pe-2")).toBeTrue();
    expect(slot.className.includes("ml-auto")).toBeTrue();
    expect(slot.getAttribute("style")?.includes("width: 144px")).toBeTrue();
    expect(slot.getAttribute("style")?.includes("min-width: 70px")).toBeTrue();
    expect(rail.className.includes("gap-1.5")).toBeTrue();
    expect(rail.className.includes("no-drag")).toBeTrue();
    expect(firstActionWrapper.className.includes("ms-auto")).toBeTrue();
    expect(textContent(rail)).toBe("FirstSecondThird");
    expect(measuredWidths[measuredWidths.length - 1]).toBe(70);
    expect(measuredRailWidths[measuredRailWidths.length - 1]).toBe(62);
  });
});
