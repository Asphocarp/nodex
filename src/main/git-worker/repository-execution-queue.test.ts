import { describe, expect, it } from "vitest";
import { RepositoryExecutionQueue } from "./repository-execution-queue";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("RepositoryExecutionQueue", () => {
  it("serializes one common directory while allowing different repositories", async () => {
    const queue = new RepositoryExecutionQueue();
    const firstGate = deferred();
    const otherGate = deferred();
    const firstStarted = deferred();
    const otherStarted = deferred();
    const starts: string[] = [];

    const first = queue.run("common-a", async () => {
      starts.push("first");
      firstStarted.resolve();
      await firstGate.promise;
      return "first-result";
    });
    const second = queue.run("common-a", async () => {
      starts.push("second");
      return "second-result";
    });
    const other = queue.run("common-b", async () => {
      starts.push("other");
      otherStarted.resolve();
      await otherGate.promise;
      return "other-result";
    });

    await Promise.all([firstStarted.promise, otherStarted.promise]);
    expect(starts).toEqual(["first", "other"]);
    firstGate.resolve();
    await expect(first).resolves.toBe("first-result");
    await expect(second).resolves.toBe("second-result");
    otherGate.resolve();
    await expect(other).resolves.toBe("other-result");
  });

  it("does not start an aborted waiter", async () => {
    const queue = new RepositoryExecutionQueue();
    const gate = deferred();
    const controller = new AbortController();
    const first = queue.run("common-a", async () => await gate.promise);
    const secondStarted: string[] = [];
    const second = queue.run(
      "common-a",
      async () => {
        secondStarted.push("started");
      },
      controller.signal,
    );
    controller.abort(new Error("canceled"));
    gate.resolve();
    await first;

    await expect(second).rejects.toThrow("canceled");
    expect(secondStarted).toEqual([]);
  });
});
