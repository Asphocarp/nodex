import { describe, expect, test } from "vite-plus/test";
import {
  keyboardActionHasContext,
  keyboardActionMayRun,
  type KeyboardActionEventLike,
  type KeyboardActionPolicy,
} from "./keyboard-action-runtime";

const defaultPolicy: KeyboardActionPolicy = {
  runWithEditableFocus: false,
  runInsideLocalSurface: false,
  runInsideTerminal: false,
  allowRepeat: false,
};

function event(overrides: Partial<KeyboardActionEventLike> = {}): KeyboardActionEventLike {
  return {
    target: null,
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    keyCode: 67,
    composedPath: () => [],
    ...overrides,
  };
}

function element(input: {
  tagName?: string;
  editable?: boolean;
  role?: string;
  contentEditable?: string;
  scope?: "local" | "terminal";
  context?: "composer";
  inputType?: string;
}): EventTarget {
  const attributes = new Map<string, string>();
  if (input.role) attributes.set("role", input.role);
  if (input.contentEditable !== undefined) {
    attributes.set("contenteditable", input.contentEditable);
  }
  if (input.scope) attributes.set("data-nodex-keyboard-scope", input.scope);
  if (input.context) attributes.set("data-nodex-keyboard-context", input.context);
  if (input.inputType) attributes.set("type", input.inputType);
  return {
    tagName: input.tagName,
    isContentEditable: input.editable ?? false,
    getAttribute: (name: string) => attributes.get(name) ?? null,
  } as unknown as EventTarget;
}

describe("keyboard action ownership", () => {
  test("runs only fresh unconsumed keyboard events", () => {
    expect(keyboardActionMayRun(event(), defaultPolicy)).toBe(true);
    expect(keyboardActionMayRun(event({ defaultPrevented: true }), defaultPolicy)).toBe(false);
    expect(keyboardActionMayRun(event({ isComposing: true }), defaultPolicy)).toBe(false);
    expect(keyboardActionMayRun(event({ keyCode: 229 }), defaultPolicy)).toBe(false);
    expect(keyboardActionMayRun(event({ repeat: true }), defaultPolicy)).toBe(false);
    expect(
      keyboardActionMayRun(event({ repeat: true }), { ...defaultPolicy, allowRepeat: true }),
    ).toBe(true);
  });

  test("keeps editable and local surface keys with their nearest owner", () => {
    const textInput = element({ tagName: "INPUT", inputType: "text" });
    const checkbox = element({ tagName: "INPUT", inputType: "checkbox" });
    const textarea = element({ tagName: "TEXTAREA" });
    const combobox = element({ tagName: "DIV", role: "combobox" });
    const editable = element({ tagName: "DIV", contentEditable: "true" });
    const explicitlyStatic = element({ tagName: "DIV", contentEditable: "false" });
    const child = element({ tagName: "BUTTON" });
    const localSurface = element({ tagName: "DIV", scope: "local" });
    const terminalSurface = element({ tagName: "DIV", scope: "terminal" });

    for (const target of [textInput, textarea, combobox, editable]) {
      expect(
        keyboardActionMayRun(
          event({
            target,
            composedPath: () => [target],
          }),
          defaultPolicy,
        ),
      ).toBe(false);
    }
    expect(
      keyboardActionMayRun(
        event({
          target: textInput,
          composedPath: () => [textInput],
        }),
        { ...defaultPolicy, runWithEditableFocus: true },
      ),
    ).toBe(true);
    expect(
      keyboardActionMayRun(
        event({
          target: checkbox,
          composedPath: () => [checkbox],
        }),
        defaultPolicy,
      ),
    ).toBe(true);
    expect(
      keyboardActionMayRun(
        event({
          target: explicitlyStatic,
          composedPath: () => [explicitlyStatic],
        }),
        defaultPolicy,
      ),
    ).toBe(true);

    expect(
      keyboardActionMayRun(
        event({
          target: child,
          composedPath: () => [child, localSurface],
        }),
        defaultPolicy,
      ),
    ).toBe(false);
    expect(
      keyboardActionMayRun(
        event({
          target: child,
          composedPath: () => [child, localSurface],
        }),
        { ...defaultPolicy, runInsideLocalSurface: true },
      ),
    ).toBe(true);
    expect(
      keyboardActionMayRun(
        event({
          target: child,
          composedPath: () => [child, localSurface, terminalSurface],
        }),
        { ...defaultPolicy, runInsideLocalSurface: true },
      ),
    ).toBe(false);
    expect(
      keyboardActionMayRun(
        event({
          target: child,
          composedPath: () => [child, localSurface, terminalSurface],
        }),
        {
          ...defaultPolicy,
          runInsideLocalSurface: true,
          runInsideTerminal: true,
        },
      ),
    ).toBe(true);
  });

  test("projects semantic keyboard context through the composed path", () => {
    const editor = element({ tagName: "DIV" });
    const composer = element({ tagName: "DIV", context: "composer" });

    expect(
      keyboardActionHasContext(
        event({
          target: editor,
          composedPath: () => [editor, composer],
        }),
        "composer",
      ),
    ).toBe(true);
    expect(
      keyboardActionHasContext(
        event({
          target: editor,
          composedPath: () => [editor],
        }),
        "composer",
      ),
    ).toBe(false);
  });
});
