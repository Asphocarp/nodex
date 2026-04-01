import type {
  CodexConversationPatchPathSegment,
  CodexConversationSnapshot,
  CodexConversationStateUpdate,
} from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (typeof value === "undefined") {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function diffValue(
  previous: unknown,
  next: unknown,
  path: CodexConversationPatchPathSegment[],
  patches: CodexConversationStateUpdate[],
): void {
  if (Object.is(previous, next)) {
    return;
  }

  const previousIsArray = Array.isArray(previous);
  const nextIsArray = Array.isArray(next);
  if (previousIsArray || nextIsArray) {
    if (!previousIsArray || !nextIsArray || previous.length !== next.length) {
      patches.push({ op: "replace", path, value: cloneValue(next) });
      return;
    }

    for (let index = 0; index < previous.length; index += 1) {
      diffValue(previous[index], next[index], [...path, index], patches);
    }
    return;
  }

  const previousIsObject = isPlainObject(previous);
  const nextIsObject = isPlainObject(next);
  if (!previousIsObject || !nextIsObject) {
    patches.push({ op: "replace", path, value: cloneValue(next) });
    return;
  }

  for (const key of Object.keys(previous)) {
    if (!(key in next)) {
      patches.push({ op: "remove", path: [...path, key] });
    }
  }

  for (const key of Object.keys(next)) {
    if (!(key in previous)) {
      patches.push({ op: "replace", path: [...path, key], value: cloneValue(next[key]) });
      continue;
    }

    diffValue(previous[key], next[key], [...path, key], patches);
  }
}

export function buildCodexConversationStateUpdates(
  previous: CodexConversationSnapshot,
  next: CodexConversationSnapshot,
): CodexConversationStateUpdate[] {
  const patches: CodexConversationStateUpdate[] = [];
  diffValue(previous, next, [], patches);
  return patches;
}

function setAtPath(target: unknown, path: CodexConversationPatchPathSegment[], value: unknown): unknown {
  if (path.length === 0) {
    return cloneValue(value);
  }

  const [head, ...tail] = path;
  if (Array.isArray(target)) {
    const nextArray = [...target];
    const index = Number(head);
    nextArray[index] = setAtPath(nextArray[index], tail, value);
    return nextArray;
  }

  const nextObject = isPlainObject(target) ? { ...target } : {};
  nextObject[String(head)] = setAtPath(nextObject[String(head)], tail, value);
  return nextObject;
}

function deleteAtPath(target: unknown, path: CodexConversationPatchPathSegment[]): unknown {
  if (path.length === 0) {
    return target;
  }

  const [head, ...tail] = path;
  if (Array.isArray(target)) {
    const nextArray = [...target];
    const index = Number(head);
    if (tail.length === 0) {
      nextArray.splice(index, 1);
      return nextArray;
    }
    nextArray[index] = deleteAtPath(nextArray[index], tail);
    return nextArray;
  }

  if (!isPlainObject(target)) {
    return target;
  }

  const nextObject = { ...target };
  const key = String(head);
  if (tail.length === 0) {
    delete nextObject[key];
    return nextObject;
  }

  nextObject[key] = deleteAtPath(nextObject[key], tail);
  return nextObject;
}

export function applyCodexConversationStateUpdates(
  conversation: CodexConversationSnapshot,
  patches: readonly CodexConversationStateUpdate[],
): CodexConversationSnapshot {
  let nextConversation: unknown = conversation;
  for (const patch of patches) {
    nextConversation = patch.op === "replace"
      ? setAtPath(nextConversation, patch.path, patch.value)
      : deleteAtPath(nextConversation, patch.path);
  }

  return nextConversation as CodexConversationSnapshot;
}
