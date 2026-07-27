export type WorkspaceFileOpenMode = "preview" | "durable";

export interface WorkspaceFileTabCandidate {
  readonly hostId: "local";
  readonly id: string;
  readonly path: string | null;
}

export type WorkspaceFileTabOpenDecision =
  | { readonly kind: "focus-durable"; readonly tabId: string }
  | { readonly kind: "focus-preview"; readonly tabId: string }
  | { readonly kind: "replace-empty"; readonly tabId: string }
  | { readonly kind: "pin-preview"; readonly tabId: string }
  | {
    readonly kind: "create-preview";
    readonly replacingPreviewTabId: string | null;
  }
  | {
    readonly kind: "create-durable";
    readonly replacingPreviewTabId: string | null;
  };

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
  if (activeEmpty) return { kind: "replace-empty", tabId: activeEmpty.id };

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

  const replacingPreviewTabId = input.previewTab?.id ?? null;
  return input.mode === "durable"
    ? { kind: "create-durable", replacingPreviewTabId }
    : { kind: "create-preview", replacingPreviewTabId };
}
