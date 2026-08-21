import { act } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { render } from "../test/dom";
import {
  executeContextualKeyboardAction,
  markContextualKeyboardActionTargetActive,
  resetContextualKeyboardActionRegistryForTests,
} from "./contextual-keyboard-actions";
import { useState } from "react";
import { useContextualKeyboardActionTarget } from "./use-contextual-keyboard-action-target";

function TargetHarness({ version, calls }: { readonly version: string; readonly calls: string[] }) {
  useContextualKeyboardActionTarget({
    surfaceId: "board",
    presentationId: "tab",
    canExecute: (commandId) => commandId === "boardFocusNext",
    execute: () => {
      calls.push(version);
      return true;
    },
  });
  return null;
}

function PeekHarness({ calls }: { readonly calls: string[] }) {
  const [open, setOpen] = useState(false);
  useContextualKeyboardActionTarget({
    surfaceId: "board",
    presentationId: "tab",
    canExecute: (commandId) => commandId === "boardPeek",
    execute: (_commandId, phase) => {
      calls.push(`${phase}:${open ? "open" : "closed"}`);
      if (phase === "keydown") setOpen(true);
      return true;
    },
  });
  return <output>{open ? "open" : "closed"}</output>;
}

describe("useContextualKeyboardActionTarget", () => {
  beforeEach(() => resetContextualKeyboardActionRegistryForTests());

  test("keeps active ownership across reactive target updates", () => {
    const calls: string[] = [];
    const view = render(<TargetHarness version="before" calls={calls} />);
    markContextualKeyboardActionTargetActive("board");

    act(() => {
      view.rerender(<TargetHarness version="after" calls={calls} />);
    });

    expect(executeContextualKeyboardAction("boardFocusNext")).toBe(true);
    expect(calls).toEqual(["after"]);

    view.unmount();
    expect(executeContextualKeyboardAction("boardFocusNext")).toBe(false);
  });

  test("retains the Peek owner from keydown through a reactive keyup", () => {
    const calls: string[] = [];
    const view = render(<PeekHarness calls={calls} />);
    markContextualKeyboardActionTargetActive("board");

    act(() => {
      expect(executeContextualKeyboardAction("boardPeek", "keydown")).toBe(true);
    });
    expect(view.getByText("open")).toBeTruthy();
    act(() => {
      expect(executeContextualKeyboardAction("boardPeek", "keyup")).toBe(true);
    });

    expect(calls).toEqual(["keydown:closed", "keyup:open"]);
  });
});
