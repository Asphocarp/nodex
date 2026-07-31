import { expect, test } from "vitest";
import { generateHomebrewCask } from "./homebrew";

test("generateHomebrewCask binds immutable version tags to canonical DMGs", () => {
  const cask = generateHomebrewCask({
    arm64Sha256: "a".repeat(64),
    version: "0.2.0",
    x64Sha256: "b".repeat(64),
  });
  expect(cask).toContain('version "0.2.0"');
  expect(cask).toContain("/releases/download/v#{version}/Nodex-latest-arm64.dmg");
  expect(cask).toContain("strategy :github_latest");
  expect(cask).not.toContain("Nodex-#{version}-arm64.dmg");
});

test("generateHomebrewCask rejects malformed checksums", () => {
  expect(() => generateHomebrewCask({
    arm64Sha256: "bad",
    version: "0.2.0",
    x64Sha256: "b".repeat(64),
  })).toThrow("SHA-256");
});
