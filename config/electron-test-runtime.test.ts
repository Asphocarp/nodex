import { describe, expect, it } from "vitest";
import { assertElectronTestRuntime } from "./electron-test-runtime";

describe("assertElectronTestRuntime", () => {
  it("accepts Electron even when its Node version matches the host", () => {
    expect(() =>
      assertElectronTestRuntime("main", {
        electron: "40.10.4",
        modules: "143",
        node: "24.15.0",
      }),
    ).not.toThrow();
  });

  it.each([
    ["main", "pnpm test:main <test-file>"],
    ["integration", "pnpm test:integration <test-file>"],
  ] as const)("rejects host Node for the %s suite", (suite, command) => {
    expect(() =>
      assertElectronTestRuntime(suite, {
        modules: "137",
        node: "24.15.0",
      }),
    ).toThrowError(
      new Error(
        [
          `${suite} tests must run in Electron's Node runtime.`,
          `Use \`${command}\`.`,
          "Do not invoke this Vitest config directly: host Node cannot load Electron-built native addons.",
          "Detected host Node 24.15.0 with NODE_MODULE_VERSION 137.",
        ].join("\n"),
      ),
    );
  });
});
