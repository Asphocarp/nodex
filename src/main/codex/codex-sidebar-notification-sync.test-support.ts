import type {
  CodexSidebarNotificationSyncLegacyPort,
  CodexSidebarNotificationSyncRequest,
} from "../codex-application/CodexSidebarNotificationSync";

/** Synchronous timer fixture for legacy CodexService integration tests only. */
export class TestCodexSidebarNotificationSync implements CodexSidebarNotificationSyncLegacyPort {
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repair: (minimumSyncGeneration: number) => Promise<void>,
    private readonly debounceMs = 300,
  ) {}

  schedule(request: CodexSidebarNotificationSyncRequest): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.repair(request.minimumSyncGeneration).catch(() => undefined);
    }, this.debounceMs);
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
