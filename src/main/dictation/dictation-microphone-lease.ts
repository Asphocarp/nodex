import type { DictationSurface } from "../../shared/dictation";

export interface DictationMicrophoneLeaseOwner {
  readonly webContentsId: number;
  readonly sessionId: string;
  readonly surface: DictationSurface;
}

/** Main-owned, compare-and-release microphone authority shared by every renderer surface. */
export class DictationMicrophoneLease {
  readonly #listeners = new Set<() => void>();
  #owner: DictationMicrophoneLeaseOwner | null = null;

  readonly getOwner = (): DictationMicrophoneLeaseOwner | null => this.#owner;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  acquire(owner: DictationMicrophoneLeaseOwner): boolean {
    const current = this.#owner;
    if (current) {
      return current.webContentsId === owner.webContentsId && current.sessionId === owner.sessionId;
    }
    this.#owner = owner;
    this.#publish();
    return true;
  }

  release(webContentsId: number, sessionId: string): boolean {
    const current = this.#owner;
    if (!current || current.webContentsId !== webContentsId || current.sessionId !== sessionId) {
      return false;
    }
    this.#owner = null;
    this.#publish();
    return true;
  }

  releaseOwner(webContentsId: number): boolean {
    if (this.#owner?.webContentsId !== webContentsId) return false;
    this.#owner = null;
    this.#publish();
    return true;
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }
}
