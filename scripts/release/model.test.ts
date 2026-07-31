import { expect, test } from "vitest";
import { latestStableAppVersion } from "./model";

test("latest stable app version ignores Browser runtime and malformed tags", () => {
  expect(latestStableAppVersion([
    "browser-runtime-v26.727.40816",
    "v0.1.10",
    "v0.2.0-beta.1",
    "not-a-release",
    "v0.2.0",
  ])).toBe("0.2.0");
});
