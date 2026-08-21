import { describe, expect, test } from "vite-plus/test";

import { parseSparkleReleaseLock } from "./sparkle-release-lock";

const validLock = {
  archive: {
    name: "Sparkle-2.9.4.tar.xz",
    sha256: "a".repeat(64),
    size: 1024,
    url: "https://github.com/sparkle-project/Sparkle/releases/download/2.9.4/Sparkle-2.9.4.tar.xz",
  },
  framework: {
    architectures: ["arm64", "x86_64"],
    bundleVersion: "2054",
    shortVersion: "2.9.4",
  },
  license: {
    path: "resources/sparkle/LICENSE",
    sha256: "c".repeat(64),
  },
  schemaVersion: 1,
  source: {
    commit: "b".repeat(40),
    repository: "https://github.com/sparkle-project/Sparkle",
    tag: "2.9.4",
  },
  version: "2.9.4",
};

describe("Sparkle release lock", () => {
  test("accepts one exact official release identity", () => {
    expect(parseSparkleReleaseLock(validLock)).toMatchObject({
      archive: { size: 1024 },
      framework: { architectures: ["arm64", "x86_64"] },
      version: "2.9.4",
    });
  });

  test("rejects a mutable or non-upstream archive URL", () => {
    expect(() =>
      parseSparkleReleaseLock({
        ...validLock,
        archive: {
          ...validLock.archive,
          url: "https://github.com/sparkle-project/Sparkle/releases/latest/download/Sparkle-2.9.4.tar.xz",
        },
      }),
    ).toThrow("official GitHub release asset");
  });

  test("rejects a framework architecture inventory that drifts from upstream", () => {
    expect(() =>
      parseSparkleReleaseLock({
        ...validLock,
        framework: { ...validLock.framework, architectures: ["arm64"] },
      }),
    ).toThrow("arm64/x86_64");
  });
});
