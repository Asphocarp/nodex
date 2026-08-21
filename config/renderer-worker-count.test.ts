import { describe, expect, test } from "vitest";

import {
  rendererWorkerAllocation,
  rendererWorkerCount,
} from "./renderer-worker-count";

describe("renderer test worker selection", () => {
  test("uses every GitHub Linux CPU for the normal CI tier", () => {
    expect(rendererWorkerCount({ ci: true, stress: false })).toBe(4);
  });

  test("reserves one worker for serialized Workbench Shell files", () => {
    expect(rendererWorkerAllocation({ ci: true })).toEqual({
      regular: 3,
      workbenchShell: 1,
    });
    expect(rendererWorkerAllocation({ ci: false })).toEqual({
      regular: 1,
      workbenchShell: 1,
    });
  });

  test("keeps the local default and serialized stress tier", () => {
    expect(rendererWorkerCount({ ci: false, stress: false })).toBe(2);
    expect(rendererWorkerCount({ ci: true, stress: true })).toBe(1);
  });
});
