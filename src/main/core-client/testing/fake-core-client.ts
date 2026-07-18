import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventSubscription,
  LibraryApplyInput,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadSnapshot,
} from "../types";

export class FakeCoreClient implements CoreClientPort {
  readonly reads: LibraryRead[] = [];
  readonly applies: LibraryApplyInput[] = [];
  readonly #readResults: LibraryReadSnapshot[] = [];
  readonly #applyResults: LibraryCommittedValue[] = [];
  readonly #eventConsumers = new Set<(event: CoreEventEnvelope) => void>();

  enqueueRead(result: LibraryReadSnapshot): void {
    this.#readResults.push(result);
  }

  enqueueApply(result: LibraryCommittedValue): void {
    this.#applyResults.push(result);
  }

  async libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot> {
    this.reads.push(read);
    const result = this.#readResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Library read");
    return result;
  }

  async libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue> {
    this.applies.push(input);
    const result = this.#applyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Library apply");
    return result;
  }

  async openEventStream(
    _after: number,
    onEvent: (event: CoreEventEnvelope) => void,
  ): Promise<CoreEventSubscription> {
    this.#eventConsumers.add(onEvent);
    let finish: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      done,
      close: () => {
        this.#eventConsumers.delete(onEvent);
        finish?.();
      },
    };
  }

  emit(event: CoreEventEnvelope): void {
    for (const consumer of this.#eventConsumers) consumer(event);
  }
}
