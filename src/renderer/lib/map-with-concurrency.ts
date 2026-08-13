/**
 * Maps values in input order while admitting at most `concurrency` async
 * operations at once. The worker pool avoids allocating one pending Promise
 * per item for protocol- or data-sized collections.
 */
export const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  project: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("concurrency must be a positive integer");
  }
  if (values.length === 0) return [];

  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  let stopped = false;
  const worker = async (): Promise<void> => {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await project(values[index] as Input, index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};
