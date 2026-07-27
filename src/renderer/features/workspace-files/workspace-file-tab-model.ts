export type WorkspaceFileOpenMode = "preview" | "durable";

export interface WorkspaceFileTabCandidate {
  readonly hostId: "local";
  readonly id: string;
  readonly path: string | null;
}

export type WorkspaceFileTabOpenDecision =
  | { readonly kind: "focus-durable"; readonly tabId: string }
  | { readonly kind: "focus-preview"; readonly tabId: string }
  | { readonly kind: "create-from-empty"; readonly emptyTabId: string }
  | { readonly kind: "pin-preview"; readonly tabId: string }
  | {
    readonly kind: "create-preview";
    readonly replacingPreviewTabId: string | null;
  }
  | { readonly kind: "create-durable" };

export function decideWorkspaceFileTabOpen(input: {
  readonly activeDurableTabId: string | null;
  readonly durableTabs: readonly WorkspaceFileTabCandidate[];
  readonly hostId: "local";
  readonly mode: WorkspaceFileOpenMode;
  readonly path: string;
  readonly previewTab: WorkspaceFileTabCandidate | null;
}): WorkspaceFileTabOpenDecision {
  const existing = input.durableTabs.find((tab) =>
    tab.hostId === input.hostId && tab.path === input.path);
  if (existing) return { kind: "focus-durable", tabId: existing.id };

  const activeEmpty = input.durableTabs.find((tab) =>
    tab.id === input.activeDurableTabId && tab.path === null);
  if (activeEmpty) {
    return { kind: "create-from-empty", emptyTabId: activeEmpty.id };
  }

  const matchingPreview = input.previewTab?.hostId === input.hostId
    && input.previewTab.path === input.path
    ? input.previewTab
    : null;
  if (matchingPreview && input.mode === "durable") {
    return { kind: "pin-preview", tabId: matchingPreview.id };
  }
  if (matchingPreview) {
    return { kind: "focus-preview", tabId: matchingPreview.id };
  }

  if (input.mode === "durable") return { kind: "create-durable" };

  return {
    kind: "create-preview",
    replacingPreviewTabId: input.previewTab?.id ?? null,
  };
}
