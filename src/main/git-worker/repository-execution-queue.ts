export class RepositoryExecutionQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<Result>(
    key: string,
    operation: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    signal?.throwIfAborted();
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(async () => await turn);
    this.#tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      signal?.throwIfAborted();
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
