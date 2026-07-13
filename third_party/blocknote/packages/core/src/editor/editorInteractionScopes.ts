export type EditorInteractionOwnership = "self" | "other" | "none";

type EditorInteractionOwner = object;

const interactionRootOwners = new WeakMap<Element, EditorInteractionOwner>();

function isElement(value: EventTarget): value is Element {
  return "nodeType" in value && (value as Node).nodeType === 1;
}

function getComposedParentElement(element: Element): Element | null {
  if (element.assignedSlot) {
    return element.assignedSlot;
  }
  if (element.parentElement) {
    return element.parentElement;
  }

  const view = element.ownerDocument.defaultView;
  const root = element.getRootNode();
  return view && root instanceof view.ShadowRoot ? root.host : null;
}

function resolveOwnerFromElement(
  element: Element,
): EditorInteractionOwner | undefined {
  for (
    let current: Element | null = element;
    current;
    current = getComposedParentElement(current)
  ) {
    const owner = interactionRootOwners.get(current);
    if (owner) {
      return owner;
    }
  }
  return undefined;
}

function resolveOwnerFromEvent(
  event: Event,
): EditorInteractionOwner | undefined {
  for (const target of event.composedPath()) {
    if (!isElement(target)) {
      continue;
    }
    const owner = interactionRootOwners.get(target);
    if (owner) {
      return owner;
    }
  }

  return event.target && isElement(event.target)
    ? resolveOwnerFromElement(event.target)
    : undefined;
}

export function registerEditorInteractionRoot(
  owner: EditorInteractionOwner,
  root: Element,
) {
  interactionRootOwners.set(root, owner);

  let registered = true;
  return () => {
    if (!registered) {
      return;
    }
    registered = false;
    if (interactionRootOwners.get(root) === owner) {
      interactionRootOwners.delete(root);
    }
  };
}

export function getEditorInteractionOwnership(
  owner: EditorInteractionOwner,
  target: Element | Event,
): EditorInteractionOwnership {
  const interactionOwner =
    target instanceof Event
      ? resolveOwnerFromEvent(target)
      : resolveOwnerFromElement(target);
  if (!interactionOwner) {
    return "none";
  }
  return interactionOwner === owner ? "self" : "other";
}
