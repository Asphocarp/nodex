export interface ExactRemoteSubscriptionLifecycle<Result> {
  ensure(): Promise<Result>;
  releaseIfIdle(): void;
}

export const createExactRemoteSubscriptionLifecycle = <Result>(input: {
  readonly hasSubscribers: () => boolean;
  readonly open: () => Promise<Result>;
  readonly isOpenResult: (result: Result) => boolean;
  readonly alreadyOpenResult: () => Result;
  readonly inactiveResult: () => Result;
  readonly close: () => Promise<unknown>;
  readonly finalize: () => void;
}): ExactRemoteSubscriptionLifecycle<Result> => {
  let disposed = false;
  let remoteOpen = false;
  let opening: Promise<Result> | null = null;
  let closing: Promise<void> | null = null;

  const ensure = (): Promise<Result> => {
    if (disposed) return Promise.resolve(input.inactiveResult());
    if (closing) return closing.then(ensure);
    if (remoteOpen) return Promise.resolve(input.alreadyOpenResult());
    if (opening) return opening;
    const command = input.open().then((result) => {
      if (input.isOpenResult(result)) remoteOpen = true;
      return result;
    }).finally(() => {
      opening = null;
    });
    opening = command;
    return command;
  };

  const releaseIfIdle = (): void => {
    if (disposed || closing || input.hasSubscribers()) return;
    const operation = (async () => {
      await opening?.catch(() => undefined);
      if (input.hasSubscribers()) return;
      if (remoteOpen) {
        remoteOpen = false;
        await input.close().catch(() => undefined);
      }
      if (input.hasSubscribers()) return;
      disposed = true;
      input.finalize();
    })();
    closing = operation.finally(() => {
      closing = null;
      if (disposed || !input.hasSubscribers()) return;
      void ensure().catch(() => undefined);
    });
  };

  return { ensure, releaseIfIdle };
};
