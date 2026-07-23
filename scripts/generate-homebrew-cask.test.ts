import { expect, test } from "vitest";
import { generateHomebrewCask } from "./generate-homebrew-cask";

const sampleSha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const otherSha256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

test("generateHomebrewCask renders architecture-specific URLs and checksums", () => {
  const cask = generateHomebrewCask({
    version: "0.2.3",
    arm64Sha256: sampleSha256,
    x64Sha256: otherSha256,
    owner: "junyudev",
    repo: "nodex",
    bundleId: "app.jyu.nodex",
    outputPath: null,
  });

  expect(cask.includes('version "0.2.3"')).toBe(true);
  expect(cask.includes(`sha256 "${sampleSha256}"`)).toBe(true);
  expect(cask.includes(`sha256 "${otherSha256}"`)).toBe(true);
  expect(cask.includes('url "https://github.com/junyudev/nodex/releases/download/v#{version}/Nodex-#{version}-arm64.dmg"')).toBe(true);
  expect(cask.includes('url "https://github.com/junyudev/nodex/releases/download/v#{version}/Nodex-#{version}-x64.dmg"')).toBe(true);
  expect(cask.includes("auto_updates true")).toBe(true);
  expect(cask.includes('binary "#{appdir}/Nodex.app/Contents/Resources/bin/nodex", target: "nodex"')).toBe(true);
});

test("generateHomebrewCask preserves Profile data when uninstalling with zap", () => {
  const cask = generateHomebrewCask({
    version: "0.2.3",
    arm64Sha256: sampleSha256,
    x64Sha256: otherSha256,
    owner: "junyudev",
    repo: "nodex",
    bundleId: "app.jyu.nodex",
    outputPath: null,
  });

  expect(cask.includes('~/Library/Preferences/app.jyu.nodex.plist')).toBe(true);
  expect(cask.includes('~/Library/Saved Application State/app.jyu.nodex.savedState')).toBe(true);
  expect(cask.includes("~/.nodex")).toBe(false);
  expect(cask.includes("~/Library/Application Support/nodex")).toBe(false);
  expect(cask.includes("strategy :github_latest")).toBe(true);
});
