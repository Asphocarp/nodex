const SUPPORTED_INPUT_METHODS = new Set([
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.insertText",
  "Input.synthesizeScrollGesture",
]);

export interface BrowserUseInputTranslationResult {
  ok: boolean;
  error?: string;
}

export function isSupportedBrowserUseInputMethod(method: string): boolean {
  return SUPPORTED_INPUT_METHODS.has(method);
}

/**
 * The script executes in the guest's main world. Keeping top-level input in
 * that world preserves focus across the app renderer and the Browser guest.
 */
export function buildBrowserUseInputTranslationScript(
  method: string,
  params: Record<string, unknown>,
): string {
  return `(${translateBrowserUseInputCommand.toString()})(${JSON.stringify({
    method,
    params,
  })});`;
}

function translateBrowserUseInputCommand(input: {
  method: string;
  params: Record<string, unknown>;
}): BrowserUseInputTranslationResult {
  const params = input.params;
  const expectedTargetTokenKey = "__codexIabExpectedInputTargetToken";
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const number = (value: unknown, label: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail(`${label} must be a finite number`);
    }
    return value;
  };
  const string = (value: unknown, label: string): string => {
    if (typeof value !== "string") return fail(`${label} must be a string`);
    return value;
  };
  const viewFor = (element: Element): Window => element.ownerDocument.defaultView ?? window;
  const modifierState = (value: unknown) => {
    const modifiers = Number(value ?? 0);
    const has = (bit: number) => Math.floor(modifiers / bit) % 2 === 1;
    return {
      altKey: has(1),
      ctrlKey: has(2),
      metaKey: has(4),
      shiftKey: has(8),
    };
  };
  const buttonNumber = (button: unknown): number => {
    if (button === "middle") return 1;
    if (button === "right") return 2;
    if (button === "back") return 3;
    if (button === "forward") return 4;
    if (button === undefined || button === "none" || button === "left") return 0;
    return fail(`Unsupported mouse button: ${String(button)}`);
  };
  const targetToken = (element: Element): string | null => {
    const value = (
      element as Element & {
        __codexIabInputTargetToken?: unknown;
      }
    ).__codexIabInputTargetToken;
    return typeof value === "string" ? value : null;
  };
  const assertExpectedTarget = (element: Element): void => {
    const expected = params[expectedTargetTokenKey];
    if (expected === undefined || expected === null) return;
    if (typeof expected !== "string" || !expected) {
      return fail(`${expectedTargetTokenKey} must be a string`);
    }
    if (targetToken(element) !== expected) {
      fail("Focused input target no longer matches the resolved locator");
    }
  };
  const deepestElementAtPoint = (
    documentValue: Document,
    x: number,
    y: number,
  ): { target: Element; x: number; y: number } | null => {
    const target = documentValue.elementFromPoint(x, y);
    if (!target) return null;
    if (target.shadowRoot) {
      const shadowTarget = target.shadowRoot.elementFromPoint(x, y);
      if (shadowTarget) return { target: shadowTarget, x, y };
    }
    if (target instanceof HTMLIFrameElement) {
      try {
        const frameDocument = target.contentWindow?.document;
        if (!frameDocument) {
          return fail(
            "Input targets inside cross-origin or inaccessible iframes are not currently supported in the in-app browser",
          );
        }
        const rect = target.getBoundingClientRect();
        return (
          deepestElementAtPoint(frameDocument, x - rect.left, y - rect.top) ?? { target, x, y }
        );
      } catch {
        fail(
          "Input targets inside cross-origin or inaccessible iframes are not currently supported in the in-app browser",
        );
      }
    }
    return { target, x, y };
  };
  const elementAtPoint = (x: number, y: number) => {
    const resolved = deepestElementAtPoint(document, x, y);
    if (!resolved) return fail(`No element found at point ${x},${y}`);
    return resolved;
  };
  const focusTarget = (element: Element): void => {
    let focusable: HTMLElement | null = null;
    if (element instanceof HTMLLabelElement && element.control) {
      focusable = element.control;
    } else {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (!(current instanceof HTMLElement)) continue;
        if (
          current.isContentEditable ||
          current.tabIndex >= 0 ||
          ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(current.tagName)
        ) {
          focusable = current;
          break;
        }
      }
    }
    if (!focusable) return;
    try {
      focusable.focus({ preventScroll: true });
    } catch {
      focusable.focus();
    }
  };
  const dispatchMouse = (element: Element, eventName: string, init: MouseEventInit): boolean => {
    const targetView = viewFor(element) as Window & {
      MouseEvent: typeof MouseEvent;
      PointerEvent?: typeof PointerEvent;
    };
    const PointerEventConstructor = targetView.PointerEvent;
    const EventConstructor =
      eventName.startsWith("pointer") && typeof PointerEventConstructor === "function"
        ? PointerEventConstructor
        : targetView.MouseEvent;
    return element.dispatchEvent(
      new EventConstructor(eventName, {
        ...init,
        ...(EventConstructor === PointerEventConstructor
          ? {
              isPrimary: true,
              pointerId: 1,
              pointerType: "mouse",
            }
          : {}),
      } as PointerEventInit),
    );
  };
  const mouseInit = (element: Element, x: number, y: number): MouseEventInit => ({
    ...modifierState(params.modifiers),
    bubbles: true,
    button: buttonNumber(params.button),
    buttons: Number(params.buttons ?? 0),
    cancelable: true,
    clientX: x,
    clientY: y,
    composed: true,
    detail: Number(params.clickCount ?? 0),
    screenX: x,
    screenY: y,
    view: viewFor(element),
  });
  const translationState = () => {
    const global = globalThis as typeof globalThis & {
      __codexIabInputTranslationState?: {
        mousePress?: {
          button: unknown;
          moved: boolean;
          x: number;
          y: number;
        } | null;
      };
    };
    global.__codexIabInputTranslationState ??= {};
    return global.__codexIabInputTranslationState;
  };
  const scroll = (element: Element, init: WheelEventInit, deltaX: number, deltaY: number): void => {
    const targetView = viewFor(element) as Window & {
      WheelEvent: typeof WheelEvent;
    };
    const wheel = new targetView.WheelEvent("wheel", {
      ...init,
      deltaMode: 0,
      deltaX,
      deltaY,
    });
    if (!element.dispatchEvent(wheel)) return;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      const canScrollY =
        deltaY !== 0 &&
        /(auto|scroll|overlay)/u.test(style.overflowY) &&
        (deltaY > 0
          ? current.scrollTop < current.scrollHeight - current.clientHeight
          : current.scrollTop > 0);
      const canScrollX =
        deltaX !== 0 &&
        /(auto|scroll|overlay)/u.test(style.overflowX) &&
        (deltaX > 0
          ? current.scrollLeft < current.scrollWidth - current.clientWidth
          : current.scrollLeft > 0);
      if (!canScrollX && !canScrollY) continue;
      current.scrollBy({ behavior: "auto", left: deltaX, top: deltaY });
      return;
    }
    viewFor(element).scrollBy({ behavior: "auto", left: deltaX, top: deltaY });
  };
  const activeElement = (root: Document | ShadowRoot): Element | null => {
    const active = root.activeElement;
    if (!active) return null;
    if (active instanceof HTMLIFrameElement) {
      try {
        const frameDocument = active.contentWindow?.document;
        return frameDocument ? (activeElement(frameDocument) ?? active) : active;
      } catch {
        return fail(
          "Input targets inside cross-origin or inaccessible iframes are not currently supported in the in-app browser",
        );
      }
    }
    return active instanceof HTMLElement && active.shadowRoot
      ? (activeElement(active.shadowRoot) ?? active)
      : active;
  };
  const editable = (): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null => {
    const active = activeElement(document);
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    ) {
      assertExpectedTarget(active);
      return active;
    }
    return null;
  };
  const setEditableText = (
    element: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
    text: string,
    inputType = "insertText",
  ): void => {
    if (!element) return fail("No editable element is focused");
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType,
    });
    if (!element.dispatchEvent(beforeInput)) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      element.setRangeText(text, start, end, "end");
    } else {
      const selection = viewFor(element).getSelection();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !element.contains(range.commonAncestorContainer)) {
        range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }
      range.deleteContents();
      const textNode = element.ownerDocument.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: text,
        inputType,
      }),
    );
  };
  const deleteText = (direction: "backward" | "forward"): void => {
    const element = editable();
    if (!element) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      const nextStart = start === end && direction === "backward" ? Math.max(0, start - 1) : start;
      const nextEnd =
        start === end && direction === "forward" ? Math.min(element.value.length, end + 1) : end;
      element.setRangeText("", nextStart, nextEnd, "end");
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: direction === "forward" ? "deleteContentForward" : "deleteContentBackward",
        }),
      );
    }
  };

  try {
    if (input.method === "Input.dispatchMouseEvent") {
      const type = string(params.type, "type");
      const pageX = number(params.x, "x");
      const pageY = number(params.y, "y");
      const { target, x, y } = elementAtPoint(pageX, pageY);
      const init = mouseInit(target, x, y);
      const state = translationState();
      if (type === "mouseMoved") {
        if (Number(params.buttons ?? 0) !== 0 && state.mousePress) {
          state.mousePress.moved = true;
        }
        dispatchMouse(target, "pointermove", init);
        dispatchMouse(target, "mousemove", init);
      } else if (type === "mousePressed") {
        state.mousePress = {
          button: params.button ?? "left",
          moved: false,
          x: pageX,
          y: pageY,
        };
        if (
          dispatchMouse(target, "pointerdown", init) &&
          dispatchMouse(target, "mousedown", init)
        ) {
          focusTarget(target);
        }
      } else if (type === "mouseReleased") {
        dispatchMouse(target, "pointerup", init);
        dispatchMouse(target, "mouseup", init);
        const press = state.mousePress;
        state.mousePress = null;
        const isClick =
          press &&
          !press.moved &&
          press.button === (params.button ?? "left") &&
          Math.abs(press.x - pageX) <= 1 &&
          Math.abs(press.y - pageY) <= 1;
        if (isClick && params.button === "right") {
          dispatchMouse(target, "contextmenu", init);
        } else if (isClick && params.button === "middle") {
          dispatchMouse(target, "auxclick", init);
        } else if (isClick) {
          dispatchMouse(target, "click", init);
          if (Number(params.clickCount ?? 0) >= 2) {
            dispatchMouse(target, "dblclick", init);
          }
        }
      } else if (type === "mouseWheel") {
        scroll(target, init, Number(params.deltaX ?? 0), Number(params.deltaY ?? 0));
      } else {
        fail(`Unsupported mouse event type: ${type}`);
      }
    } else if (input.method === "Input.insertText") {
      setEditableText(editable(), string(params.text, "text"));
    } else if (input.method === "Input.synthesizeScrollGesture") {
      const x = number(params.x, "x");
      const y = number(params.y, "y");
      const { target, x: targetX, y: targetY } = elementAtPoint(x, y);
      scroll(
        target,
        mouseInit(target, targetX, targetY),
        -Number(params.xDistance ?? 0),
        -Number(params.yDistance ?? 0),
      );
    } else if (input.method === "Input.dispatchKeyEvent") {
      const type = string(params.type, "type");
      const target = activeElement(document) ?? document.body ?? document.documentElement;
      assertExpectedTarget(target);
      const key =
        typeof params.key === "string"
          ? params.key
          : typeof params.code === "string"
            ? params.code
            : "";
      const keyCode = Number(params.windowsVirtualKeyCode ?? 0);
      const init: KeyboardEventInit = {
        ...modifierState(params.modifiers),
        bubbles: true,
        cancelable: true,
        code: typeof params.code === "string" ? params.code : "",
        composed: true,
        key,
        location: Number(params.location ?? 0),
        repeat: params.autoRepeat === true,
      };
      const eventName = type === "keyUp" ? "keyup" : "keydown";
      const event = new KeyboardEvent(eventName, init);
      Object.defineProperty(event, "keyCode", { get: () => keyCode });
      Object.defineProperty(event, "which", { get: () => keyCode });
      const allowed = target.dispatchEvent(event);
      if (type === "keyUp" || !allowed) return { ok: true };
      const commands = Array.isArray(params.commands) ? params.commands : [];
      if (commands.includes("selectAll")) {
        const element = editable();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.setSelectionRange(0, element.value.length);
        } else {
          element?.ownerDocument.execCommand?.("selectAll");
        }
      }
      if (commands.includes("deleteBackward") || key === "Backspace") {
        deleteText("backward");
      }
      if (commands.includes("deleteForward") || key === "Delete") {
        deleteText("forward");
      }
      const text = typeof params.text === "string" ? params.text : "";
      if (text) setEditableText(editable(), text);
      if (!text && key === "Enter") {
        const element = editable();
        if (
          element instanceof HTMLTextAreaElement ||
          (element instanceof HTMLElement && element.isContentEditable)
        ) {
          setEditableText(element, "\n", "insertLineBreak");
        }
      }
    } else {
      fail(`Unsupported Browser Use input method: ${input.method}`);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
