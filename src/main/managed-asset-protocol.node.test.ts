import { afterEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Session } from "electron";
import {
  createManagedAssetProtocolHandler,
  registerManagedAssetProtocol,
} from "./managed-asset-protocol";

const fixtureRoots: string[] = [];

function createFixture(): {
  rootPath: string;
  handle: ReturnType<typeof createManagedAssetProtocolHandler>;
} {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-asset-protocol-"));
  fixtureRoots.push(rootPath);
  return {
    rootPath,
    handle: createManagedAssetProtocolHandler({ assetsRootPath: rootPath }),
  };
}

afterEach(() => {
  for (const rootPath of fixtureRoots.splice(0)) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

describe("managed asset protocol", () => {
  test("serves allowlisted raster images with bounded response headers", async () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.rootPath, "image.png"), "png-bytes");

    const result = await fixture.handle(
      new Request("nodex-asset://managed/image.png"),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("image/png");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await result.text()).toBe("png-bytes");
  });

  test("supports HEAD without returning bytes", async () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.rootPath, "image.webp"), "webp");

    const result = await fixture.handle(
      new Request("nodex-asset://managed/image.webp", { method: "HEAD" }),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("content-length")).toBe("4");
    expect(await result.text()).toBe("");
  });

  test.each([
    "nodex-asset://other/image.png",
    "nodex-asset://managed/nested/image.png",
    "nodex-asset://managed/%2e%2e%2fimage.png",
    "nodex-asset://managed/image.png?download=1",
    "nodex-asset://managed/image.svg",
    "nodex-asset://managed/readme.txt",
  ])("rejects an unsafe request: %s", async (url) => {
    const fixture = createFixture();
    expect((await fixture.handle(new Request(url))).status).toBeGreaterThanOrEqual(400);
  });

  test("rejects unsupported methods with an Allow header", async () => {
    const fixture = createFixture();
    const result = await fixture.handle(
      new Request("nodex-asset://managed/image.png", { method: "POST" }),
    );
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("GET, HEAD");
  });

  test("does not follow symlinks or serve directories", async () => {
    const fixture = createFixture();
    const outsidePath = path.join(os.tmpdir(), `nodex-outside-${crypto.randomUUID()}.png`);
    fs.writeFileSync(outsidePath, "outside");
    fs.symlinkSync(outsidePath, path.join(fixture.rootPath, "linked.png"));
    fs.mkdirSync(path.join(fixture.rootPath, "folder.png"));
    try {
      expect((await fixture.handle(
        new Request("nodex-asset://managed/linked.png"),
      )).status).toBe(404);
      expect((await fixture.handle(
        new Request("nodex-asset://managed/folder.png"),
      )).status).toBe(404);
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  });

  test("registers and disposes only on the supplied Electron session", () => {
    const calls: string[] = [];
    let handled = false;
    const electronSession = {
      protocol: {
        handle: (scheme: string) => {
          handled = true;
          calls.push(`handle:${scheme}`);
        },
        unhandle: (scheme: string) => {
          if (!handled) throw new Error("Protocol is not handled");
          handled = false;
          calls.push(`unhandle:${scheme}`);
        },
        isProtocolHandled: () => handled,
      },
    } as unknown as Session;

    const dispose = registerManagedAssetProtocol(electronSession);
    dispose();
    dispose();

    expect(calls).toEqual([
      "handle:nodex-asset",
      "unhandle:nodex-asset",
    ]);
  });

  test("replaces an existing managed-asset handler before registration", () => {
    const calls: string[] = [];
    let handled = true;
    const electronSession = {
      protocol: {
        handle: (scheme: string) => {
          handled = true;
          calls.push(`handle:${scheme}`);
        },
        unhandle: (scheme: string) => {
          if (!handled) throw new Error("Protocol is not handled");
          handled = false;
          calls.push(`unhandle:${scheme}`);
        },
        isProtocolHandled: () => handled,
      },
    } as unknown as Session;

    registerManagedAssetProtocol(electronSession);

    expect(calls).toEqual([
      "unhandle:nodex-asset",
      "handle:nodex-asset",
    ]);
  });
});
