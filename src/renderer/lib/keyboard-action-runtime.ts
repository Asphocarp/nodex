export interface KeyboardActionEventLike {
  readonly target: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly repeat: boolean;
  readonly keyCode: number;
  readonly composedPath?: () => readonly EventTarget[];
}

export interface KeyboardActionPolicy {
  readonly runWithEditableFocus: boolean;
  readonly runInsideLocalSurface: boolean;
  readonly runInsideTerminal: boolean;
  readonly allowRepeat: boolean;
}

export type KeyboardActionSurfaceScope = "global" | "editable" | "local" | "terminal";

export type KeyboardActionContext = "composer";

interface KeyboardActionElementLike extends EventTarget {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly type?: string;
  getAttribute?: (name: string) => string | null;
}

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "radio", "reset", "submit"]);

const EDITABLE_ROLES = new Set(["combobox", "searchbox", "textbox"]);

function eventPath(event: KeyboardActionEventLike): readonly EventTarget[] {
  const path = event.composedPath?.() ?? [];
  if (path.length > 0) return path;
  return event.target ? [event.target] : [];
}

function asElement(target: EventTarget): KeyboardActionElementLike | null {
  const candidate = target as KeyboardActionElementLike;
  if (typeof candidate.tagName === "string") return candidate;
  if (typeof candidate.getAttribute === "function") return candidate;
  return null;
}

function keyboardScopeAttribute(element: KeyboardActionElementLike): "local" | "terminal" | null {
  const value = element.getAttribute?.("data-nodex-keyboard-scope");
  return value === "local" || value === "terminal" ? value : null;
}

export function keyboardActionHasContext(
  event: KeyboardActionEventLike,
  context: KeyboardActionContext,
): boolean {
  return eventPath(event).some((target) => {
    const element = asElement(target);
    return element?.getAttribute?.("data-nodex-keyboard-context") === context;
  });
}

function elementIsTextInput(element: KeyboardActionElementLike): boolean {
  const tagName = element.tagName?.toUpperCase();
  if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
  if (tagName !== "INPUT") return false;
  const type = (element.type ?? element.getAttribute?.("type") ?? "text").toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

function elementHasEditableRole(element: KeyboardActionElementLike): boolean {
  const role = element.getAttribute?.("role")?.toLowerCase();
  return role ? EDITABLE_ROLES.has(role) : false;
}

export function classifyKeyboardActionSurface(
  event: KeyboardActionEventLike,
): KeyboardActionSurfaceScope {
  return classifyKeyboardActionPath(eventPath(event));
}

export function classifyKeyboardActionPath(
  path: readonly EventTarget[],
): KeyboardActionSurfaceScope {
  const elements = path.flatMap((target) => {
    const element = asElement(target);
    return element ? [element] : [];
  });

  for (const element of elements) {
    if (keyboardScopeAttribute(element) === "terminal") return "terminal";
  }
  for (const element of elements) {
    if (keyboardScopeAttribute(element) === "local") return "local";
  }

  let contentEditableBoundaryReached = false;
  for (const element of elements) {
    if (elementIsTextInput(element) || elementHasEditableRole(element)) {
      return "editable";
    }

    const contentEditable = element.getAttribute?.("contenteditable");
    if (contentEditable !== null && contentEditable !== undefined) {
      contentEditableBoundaryReached = true;
      if (contentEditable.toLowerCase() !== "false") return "editable";
      continue;
    }
    if (!contentEditableBoundaryReached && element.isContentEditable) {
      return "editable";
    }
  }

  return "global";
}

export function keyboardActionMayRun(
  event: KeyboardActionEventLike,
  policy: KeyboardActionPolicy,
): boolean {
  if (event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.repeat && !policy.allowRepeat) return false;

  const scope = classifyKeyboardActionSurface(event);
  if (scope === "terminal") return policy.runInsideTerminal;
  if (scope === "local") return policy.runInsideLocalSurface;
  if (scope === "editable") return policy.runWithEditableFocus;
  return true;
}
