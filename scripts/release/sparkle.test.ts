import { expect, test } from "vitest";

import { isEligibleSparkleHistoryRelease, selectLatestSparkleHistoryAppcast } from "./sparkle";

test("selects Sparkle history by semantic version rather than filename order", () => {
  expect(
    selectLatestSparkleHistoryAppcast([
      "/history/Nodex-0.2.9-appcast-arm64.xml",
      "/history/Nodex-0.2.10-appcast-arm64.xml",
      "/history/unrelated.xml",
    ]),
  ).toBe("/history/Nodex-0.2.10-appcast-arm64.xml");
});

test("accepts only immutable published releases as delta history", () => {
  expect(
    isEligibleSparkleHistoryRelease({
      draft: false,
      immutable: true,
      prerelease: false,
    }),
  ).toBe(true);
  expect(
    isEligibleSparkleHistoryRelease({
      draft: false,
      immutable: false,
      prerelease: false,
    }),
  ).toBe(false);
  expect(
    isEligibleSparkleHistoryRelease({
      draft: false,
      prerelease: false,
    }),
  ).toBe(false);
});
