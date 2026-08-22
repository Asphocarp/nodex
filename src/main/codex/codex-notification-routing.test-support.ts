import type { CodexNotificationRoutingLegacyPort } from "../codex-application/CodexNotificationRouting";
import type { CodexServerNotification } from "../codex-runtime/CodexApplicationClient";

/** Promise fixture for legacy CodexService integration tests only. */
export class TestCodexNotificationRouting implements CodexNotificationRoutingLegacyPort {
  #queue = Promise.resolve();

  constructor(private readonly route: (notification: CodexServerNotification) => Promise<void>) {}

  offer(notification: CodexServerNotification): void {
    this.#queue = this.#queue.then(async () => this.route(notification)).catch(() => undefined);
  }
}
