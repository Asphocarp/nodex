import { describe, expect, test } from "vitest";

import { mapWithConcurrency } from "./map-with-concurrency";

describe("mapWithConcurrency", () => {
  test("preserves input order while bounding active work", async () => {
    let active = 0;
    let maxActive = 0;
    const values = Array.from({ length: 24 }, (_, index) => index);

    const results = await mapWithConcurrency(values, 4, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, (value % 3) + 1);
      });
      active -= 1;
      return value * 2;
    });

    expect(maxActive).toBe(4);
    expect(results).toEqual(values.map((value) => value * 2));
  });

  test("rejects an invalid concurrency bound before starting work", async () => {
    let started = false;
    await expect(
      mapWithConcurrency([1], 0, async () => {
        started = true;
        return 1;
      }),
    ).rejects.toThrow("concurrency must be a positive integer");
    expect(started).toBe(false);
  });
});
