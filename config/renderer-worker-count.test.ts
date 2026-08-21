import { describe, expect, test } from "vite-plus/test";

import { rendererWorkerCount } from "./renderer-worker-count";

describe("renderer test worker selection", () => {
  test("uses every GitHub Linux CPU for the normal CI tier", () => {
    expect(rendererWorkerCount({ ci: true, stress: false })).toBe(4);
  });

  test("keeps the local default and serialized stress tier", () => {
    expect(rendererWorkerCount({ ci: false, stress: false })).toBe(2);
    expect(rendererWorkerCount({ ci: true, stress: true })).toBe(1);
  });
});
