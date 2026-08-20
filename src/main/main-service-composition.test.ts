import { describe, expect, test } from "vite-plus/test";
import {
  activateMainServiceComposition,
  getMainServiceComposition,
  type MainServiceComposition,
} from "./main-service-composition";

const fakeComposition = (identity: string): MainServiceComposition =>
  ({ identity }) as unknown as MainServiceComposition;

describe("Main service composition activation", () => {
  test("publishes exactly one explicitly constructed composition", () => {
    const composition = fakeComposition("primary");
    const release = activateMainServiceComposition(composition);
    try {
      expect(getMainServiceComposition()).toBe(composition);
      expect(() => activateMainServiceComposition(fakeComposition("duplicate"))).toThrow(
        "already active",
      );
    } finally {
      release();
    }

    expect(() => getMainServiceComposition()).toThrow("has not been activated");
  });

  test("does not let a stale release clear a newer composition", () => {
    const releaseFirst = activateMainServiceComposition(fakeComposition("first"));
    releaseFirst();

    const second = fakeComposition("second");
    const releaseSecond = activateMainServiceComposition(second);
    try {
      releaseFirst();
      expect(getMainServiceComposition()).toBe(second);
    } finally {
      releaseSecond();
    }
  });
});
