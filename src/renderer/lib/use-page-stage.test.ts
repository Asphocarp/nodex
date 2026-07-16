import { describe, expect, test } from "vitest";

import {
  closePageStageState,
  openPageStageState,
  type PageStageState,
} from "./use-page-stage";

const CLOSED_STATE: PageStageState = {
  open: false,
  projectId: "",
  pageId: null,
};

describe("page stage pointer state helpers", () => {
  test("openPageStageState sets project/page pointer", () => {
    const opened = openPageStageState(CLOSED_STATE, "default", "page-1");

    expect(JSON.stringify(opened)).toBe(JSON.stringify({
      open: true,
      projectId: "default",
      pageId: "page-1",
    }));
  });

  test("openPageStageState ignores empty pointer inputs", () => {
    const noProject = openPageStageState(CLOSED_STATE, "", "page-1");
    const noPage = openPageStageState(CLOSED_STATE, "default", "");

    expect(noProject).toBe(CLOSED_STATE);
    expect(noPage).toBe(CLOSED_STATE);
  });

  test("closePageStageState only flips open flag", () => {
    const opened = openPageStageState(CLOSED_STATE, "default", "page-1");
    const closed = closePageStageState(opened);

    expect(JSON.stringify(closed)).toBe(JSON.stringify({
      open: false,
      projectId: "default",
      pageId: "page-1",
    }));
  });
});
