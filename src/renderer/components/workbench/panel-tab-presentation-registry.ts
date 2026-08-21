export const PANEL_TAB_PRESENTATION_EXIT_DURATION_MS = 150;

export interface PanelTabPresentationInput {
  readonly id: string;
  readonly preview: boolean;
}

export interface PanelTabPresentationProjection {
  readonly id: string;
  readonly presentationId: string;
}

interface PanelTabPresentationEntry extends PanelTabPresentationProjection {
  readonly preview: boolean;
}

interface RetiredPanelTabPresentation {
  readonly presentationId: string;
  readonly expiresAt: number;
}

interface PanelTabPresentationRegistryOptions {
  readonly createId?: () => string;
  readonly exitDurationMs?: number;
}

export class PanelTabPresentationRegistry {
  readonly #controllers = new Map<string, Map<string, PanelTabPresentationEntry>>();
  readonly #ownersByTabId = new Map<string, string>();
  readonly #retiredByTabId = new Map<string, RetiredPanelTabPresentation>();
  readonly #createId: () => string;
  readonly #exitDurationMs: number;

  constructor(options: PanelTabPresentationRegistryOptions = {}) {
    let nextId = 0;
    this.#createId = options.createId ?? (() => `app-shell-tab:${++nextId}`);
    this.#exitDurationMs = options.exitDurationMs ?? PANEL_TAB_PRESENTATION_EXIT_DURATION_MS;
  }

  reconcile(
    controllerKey: string,
    tabs: readonly PanelTabPresentationInput[],
    now = Date.now(),
  ): readonly PanelTabPresentationProjection[] {
    this.prune(now);
    const previousEntries = this.#controllers.get(controllerKey) ?? new Map();
    const nextTabIds = new Set(tabs.map((tab) => tab.id));
    const outgoingPreview = [...previousEntries.values()].find(
      (entry) => entry.preview && !nextTabIds.has(entry.id),
    );
    let previewPresentationId = outgoingPreview?.presentationId ?? null;
    const nextEntries = new Map<string, PanelTabPresentationEntry>();

    for (const tab of tabs) {
      const previousEntry = previousEntries.get(tab.id);
      const presentationId =
        previousEntry?.presentationId ??
        this.#takeActivePresentation(tab.id) ??
        this.#takeRetiredPresentation(tab.id, now) ??
        (tab.preview && previewPresentationId ? previewPresentationId : this.#createId());

      if (tab.preview && previewPresentationId === presentationId) {
        previewPresentationId = null;
      }

      nextEntries.set(tab.id, {
        id: tab.id,
        presentationId,
        preview: tab.preview,
      });
      this.#ownersByTabId.set(tab.id, controllerKey);
      this.#retiredByTabId.delete(tab.id);
    }

    const activePresentationIds = new Set(
      [...nextEntries.values()].map((entry) => entry.presentationId),
    );
    for (const entry of previousEntries.values()) {
      if (nextEntries.has(entry.id)) continue;
      if (this.#ownersByTabId.get(entry.id) !== controllerKey) continue;
      this.#ownersByTabId.delete(entry.id);
      if (activePresentationIds.has(entry.presentationId)) continue;
      this.#retire(entry, now);
    }

    this.#controllers.set(controllerKey, nextEntries);
    return tabs.map((tab) => {
      const entry = nextEntries.get(tab.id);
      if (!entry) throw new Error(`Missing panel tab presentation for ${tab.id}`);
      return {
        id: entry.id,
        presentationId: entry.presentationId,
      };
    });
  }

  releaseController(controllerKey: string, now = Date.now()): void {
    const entries = this.#controllers.get(controllerKey);
    if (!entries) return;

    for (const entry of entries.values()) {
      if (this.#ownersByTabId.get(entry.id) !== controllerKey) continue;
      this.#ownersByTabId.delete(entry.id);
      this.#retire(entry, now);
    }
    this.#controllers.delete(controllerKey);
  }

  prune(now = Date.now()): void {
    for (const [tabId, retired] of this.#retiredByTabId) {
      if (retired.expiresAt > now) continue;
      this.#retiredByTabId.delete(tabId);
    }
  }

  dispose(): void {
    this.#controllers.clear();
    this.#ownersByTabId.clear();
    this.#retiredByTabId.clear();
  }

  #takeActivePresentation(tabId: string): string | null {
    const owner = this.#ownersByTabId.get(tabId);
    if (!owner) return null;
    return this.#controllers.get(owner)?.get(tabId)?.presentationId ?? null;
  }

  #takeRetiredPresentation(tabId: string, now: number): string | null {
    const retired = this.#retiredByTabId.get(tabId);
    if (!retired) return null;
    this.#retiredByTabId.delete(tabId);
    return retired.expiresAt > now ? retired.presentationId : null;
  }

  #retire(entry: PanelTabPresentationEntry, now: number): void {
    this.#retiredByTabId.set(entry.id, {
      presentationId: entry.presentationId,
      expiresAt: now + this.#exitDurationMs,
    });
  }
}
