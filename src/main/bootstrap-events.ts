export type BootstrapRuntimeEvent =
  | { type: "open-url"; url: string }
  | { type: "second-instance"; argv: string[] };

export interface BootstrapRuntimeController {
  handleOpenUrl(url: string): unknown | Promise<unknown>;
  handleSecondInstance(argv: string[]): unknown | Promise<unknown>;
  shutdown?(): void | Promise<void>;
}

export class BootstrapRuntimeEventQueue {
  private controller: BootstrapRuntimeController | null = null;
  private readonly pendingEvents: BootstrapRuntimeEvent[] = [];

  enqueueOpenUrl(url: string): Promise<void> {
    return this.enqueue({ type: "open-url", url });
  }

  enqueueSecondInstance(argv: string[]): Promise<void> {
    return this.enqueue({ type: "second-instance", argv: [...argv] });
  }

  takePendingEvents(): BootstrapRuntimeEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return events;
  }

  async attachController(controller: BootstrapRuntimeController): Promise<void> {
    this.controller = controller;
    const events = this.takePendingEvents();
    for (const event of events) {
      await this.dispatch(event);
    }
  }

  private async enqueue(event: BootstrapRuntimeEvent): Promise<void> {
    if (!this.controller) {
      this.pendingEvents.push(event);
      return;
    }

    await this.dispatch(event);
  }

  private async dispatch(event: BootstrapRuntimeEvent): Promise<void> {
    if (!this.controller) {
      this.pendingEvents.push(event);
      return;
    }

    if (event.type === "open-url") {
      await this.controller.handleOpenUrl(event.url);
      return;
    }

    await this.controller.handleSecondInstance(event.argv);
  }
}
