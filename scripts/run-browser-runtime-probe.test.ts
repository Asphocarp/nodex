import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildBrowserRuntimeProbeInvocation } from "./run-browser-runtime-probe";

describe("Browser runtime probe launcher", () => {
  test("uses absolute runtime paths when relaunching in a desktop app context", () => {
    const root = path.resolve("/tmp/nodex probe");
    const command = buildBrowserRuntimeProbeInvocation(
      root,
      ["--resources-path", "/tmp/Nodex.app/Contents/Resources"],
      "/opt/node/bin/node",
    );

    expect(command).toEqual({
      args: [
        path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(root, "scripts", "probe-browser-runtime.ts"),
        "--resources-path",
        "/tmp/Nodex.app/Contents/Resources",
      ],
      command: "/opt/node/bin/node",
    });
  });
});
