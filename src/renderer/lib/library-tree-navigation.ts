export type LibraryTreeKeyboardAction =
  | { readonly kind: "focus"; readonly key: string }
  | { readonly kind: "expand"; readonly key: string }
  | { readonly kind: "collapse"; readonly key: string }
  | { readonly kind: "open"; readonly key: string }
  | { readonly kind: "none" };

export const resolveLibraryTreeKeyboardAction = (input: Readonly<{
  key: string;
  currentKey: string;
  visibleKeys: readonly string[];
  parentKey: string | null;
  expandable: boolean;
  expanded: boolean;
}>): LibraryTreeKeyboardAction => {
  const index = input.visibleKeys.indexOf(input.currentKey);
  if (input.key === "Enter" || input.key === " ") {
    return { kind: "open", key: input.currentKey };
  }
  if (input.key === "ArrowDown" && index >= 0) {
    return {
      kind: "focus",
      key: input.visibleKeys[Math.min(index + 1, input.visibleKeys.length - 1)]
        ?? input.currentKey,
    };
  }
  if (input.key === "ArrowUp" && index >= 0) {
    return {
      kind: "focus",
      key: input.visibleKeys[Math.max(index - 1, 0)] ?? input.currentKey,
    };
  }
  if (input.key === "Home") {
    return { kind: "focus", key: input.visibleKeys[0] ?? input.currentKey };
  }
  if (input.key === "End") {
    return {
      kind: "focus",
      key: input.visibleKeys.at(-1) ?? input.currentKey,
    };
  }
  if (input.key === "ArrowRight") {
    if (input.expandable && !input.expanded) {
      return { kind: "expand", key: input.currentKey };
    }
    if (input.expanded && index >= 0) {
      return {
        kind: "focus",
        key: input.visibleKeys[index + 1] ?? input.currentKey,
      };
    }
  }
  if (input.key === "ArrowLeft") {
    if (input.expandable && input.expanded) {
      return { kind: "collapse", key: input.currentKey };
    }
    if (input.parentKey) return { kind: "focus", key: input.parentKey };
  }
  return { kind: "none" };
};

export const findLibraryTreeTypeaheadTarget = (input: Readonly<{
  labels: readonly { readonly key: string; readonly label: string }[];
  currentKey: string;
  query: string;
}>): string | null => {
  const query = input.query.trim().toLocaleLowerCase();
  if (!query || input.labels.length === 0) return null;
  const currentIndex = input.labels.findIndex((entry) => entry.key === input.currentKey);
  for (let offset = 1; offset <= input.labels.length; offset += 1) {
    const index = (Math.max(currentIndex, -1) + offset) % input.labels.length;
    const entry = input.labels[index];
    if (entry?.label.toLocaleLowerCase().startsWith(query)) return entry.key;
  }
  return null;
};

export const updateLibraryTreeTypeaheadBuffer = (input: Readonly<{
  buffer: string;
  lastTypedAt: number;
  key: string;
  now: number;
  timeoutMs?: number;
}>): { readonly buffer: string; readonly lastTypedAt: number } => {
  const timeoutMs = input.timeoutMs ?? 700;
  const append = input.now - input.lastTypedAt <= timeoutMs;
  return {
    buffer: append ? `${input.buffer}${input.key}` : input.key,
    lastTypedAt: input.now,
  };
};
