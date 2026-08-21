import { beforeEach, describe, expect, test } from "vite-plus/test";
import {
  canExecuteContextualKeyboardAction,
  executeContextualKeyboardAction,
  markContextualKeyboardActionPresentationActive,
  markContextualKeyboardActionTargetActive,
  registerContextualKeyboardActionTarget,
  resetContextualKeyboardActionRegistryForTests,
  unregisterContextualKeyboardActionTarget,
} from "./contextual-keyboard-actions";

describe("contextual keyboard action registry", () => {
  beforeEach(() => resetContextualKeyboardActionRegistryForTests());

  test("routes actions to the most recently active registered surface", () => {
    const calls: string[] = [];
    registerContextualKeyboardActionTarget("one", {
      surfaceId: "board-one",
      presentationId: "tab-one",
      canExecute: (commandId) => commandId === "boardOpen",
      execute: () => {
        calls.push("one");
        return true;
      },
    });
    registerContextualKeyboardActionTarget("two", {
      surfaceId: "board-two",
      presentationId: "tab-two",
      canExecute: (commandId) => commandId === "boardOpen",
      execute: () => {
        calls.push("two");
        return true;
      },
    });

    markContextualKeyboardActionTargetActive("board-one");
    expect(canExecuteContextualKeyboardAction("boardOpen")).toBe(true);
    expect(executeContextualKeyboardAction("boardOpen")).toBe(true);
    expect(calls).toEqual(["one"]);

    markContextualKeyboardActionTargetActive("board-two");
    expect(executeContextualKeyboardAction("boardOpen")).toBe(true);
    expect(calls).toEqual(["one", "two"]);
  });

  test("ignores stale unregister calls and fails open without a capability", () => {
    registerContextualKeyboardActionTarget("current", {
      surfaceId: "board",
      presentationId: "tab",
      canExecute: () => false,
      execute: () => {
        throw new Error("Unavailable action must not execute");
      },
    });
    unregisterContextualKeyboardActionTarget("board", "stale");
    expect(executeContextualKeyboardAction("boardOpen")).toBe(false);
    unregisterContextualKeyboardActionTarget("board", "current");
    expect(canExecuteContextualKeyboardAction("boardOpen")).toBe(false);
  });

  test("uses a sole mounted surface before pointer activation", () => {
    registerContextualKeyboardActionTarget("current", {
      surfaceId: "board",
      presentationId: "tab",
      canExecute: (commandId) => commandId === "boardFocusNext",
      execute: () => true,
    });

    expect(executeContextualKeyboardAction("boardFocusNext")).toBe(true);
  });

  test("preserves ownership when a mounted surface updates its target", () => {
    const calls: string[] = [];
    registerContextualKeyboardActionTarget("current", {
      surfaceId: "board",
      presentationId: "tab",
      canExecute: () => true,
      execute: () => {
        calls.push("before");
        return true;
      },
    });
    markContextualKeyboardActionTargetActive("board");

    registerContextualKeyboardActionTarget("current", {
      surfaceId: "board",
      presentationId: "tab",
      canExecute: () => true,
      execute: () => {
        calls.push("after");
        return true;
      },
    });

    expect(executeContextualKeyboardAction("boardOpen")).toBe(true);
    expect(calls).toEqual(["after"]);
  });

  test("routes by the Workbench presentation and blocks background Boards", () => {
    const calls: string[] = [];
    for (const id of ["one", "two"]) {
      registerContextualKeyboardActionTarget(id, {
        surfaceId: `board-${id}`,
        presentationId: `tab-${id}`,
        canExecute: () => true,
        execute: () => {
          calls.push(id);
          return true;
        },
      });
    }

    markContextualKeyboardActionPresentationActive("tab-two");
    expect(executeContextualKeyboardAction("boardFocusNext")).toBe(true);
    expect(calls).toEqual(["two"]);

    markContextualKeyboardActionPresentationActive("browser-tab");
    expect(executeContextualKeyboardAction("boardFocusNext")).toBe(false);
    expect(calls).toEqual(["two"]);
  });

  test("preserves the engaged surface when a presentation has multiple targets", () => {
    const calls: string[] = [];
    for (const id of ["primary", "nested"]) {
      registerContextualKeyboardActionTarget(id, {
        surfaceId: `board-${id}`,
        presentationId: "shared-tab",
        canExecute: () => true,
        execute: () => {
          calls.push(id);
          return true;
        },
      });
    }

    markContextualKeyboardActionTargetActive("board-nested");
    expect(executeContextualKeyboardAction("boardFocusNext")).toBe(true);
    expect(calls).toEqual(["nested"]);
  });
});
