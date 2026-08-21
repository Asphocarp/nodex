import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createAppRendererProtocolHandler } from "./app-renderer-protocol";

const temporaryRoots: string[] = [];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-app-protocol-"));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><main>Nodex</main>");
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "main.js"), "export {};");
  return {
    handler: createAppRendererProtocolHandler({ rendererRoot: root }),
    root,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("app renderer protocol", () => {
  test("serves exact renderer assets with the top-level CSP", async () => {
    const { handler } = createFixture();
    const response = await handler(new Request("app://-/index.html"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    await expect(response.text()).resolves.toContain("Nodex");
  });

  test("does not turn missing or traversal paths into index HTML", async () => {
    const { handler } = createFixture();

    await expect(handler(new Request("app://-/missing"))).resolves.toMatchObject({ status: 404 });
    await expect(handler(new Request("app://-/%2e%2e%2fsecret"))).resolves.toMatchObject({
      status: 400,
    });
  });

  test("rejects foreign hosts and mutations", async () => {
    const { handler } = createFixture();

    await expect(handler(new Request("app://foreign/index.html"))).resolves.toMatchObject({
      status: 400,
    });
    await expect(handler(new Request("app:///index.html"))).resolves.toMatchObject({ status: 400 });
    await expect(
      handler(new Request("app://-/index.html", { method: "POST" })),
    ).resolves.toMatchObject({ status: 405 });
  });
});
