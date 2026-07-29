import { describe, expect, test, vi } from "vitest";
import {
  BrowserLocalServerThumbnailService,
  normalizeLocalServerThumbnailUrl,
} from "./browser-local-server-thumbnail";

describe("normalizeLocalServerThumbnailUrl", () => {
  test("accepts loopback HTTP(S) routes and rejects remote or credential URLs", () => {
    expect(normalizeLocalServerThumbnailUrl("http://localhost:3000/app#state"))
      .toBe("http://localhost:3000/app");
    expect(normalizeLocalServerThumbnailUrl("https://127.0.0.1:8443/"))
      .toBe("https://127.0.0.1:8443/");
    expect(normalizeLocalServerThumbnailUrl("http://[::1]:4173/"))
      .toBe("http://[::1]:4173/");
    expect(normalizeLocalServerThumbnailUrl("https://example.com/")).toBeNull();
    expect(normalizeLocalServerThumbnailUrl("http://user:secret@localhost:3000/"))
      .toBeNull();
  });
});

describe("BrowserLocalServerThumbnailService", () => {
  test("deduplicates identical work, bounds concurrency, and reuses the cache", async () => {
    const releases: Array<(value: string) => void> = [];
    let active = 0;
    let maximumActive = 0;
    const capture = vi.fn(async () => await new Promise<string>((resolve) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      releases.push((value) => {
        active -= 1;
        resolve(value);
      });
    }));
    const service = new BrowserLocalServerThumbnailService({
      capture,
      maxConcurrency: 1,
    });

    const first = service.get("http://localhost:3000/");
    const duplicate = service.get("http://localhost:3000/");
    const second = service.get("http://localhost:4000/");
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);

    releases.shift()?.("data:image/png;base64,first");
    await expect(first).resolves.toMatchObject({ status: "ready" });
    await expect(duplicate).resolves.toMatchObject({ status: "ready" });
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(2);
    releases.shift()?.("data:image/png;base64,second");
    await expect(second).resolves.toMatchObject({ status: "ready" });
    expect(maximumActive).toBe(1);

    await expect(service.get("http://localhost:3000/")).resolves.toMatchObject({
      status: "ready",
      dataUrl: "data:image/png;base64,first",
    });
    expect(capture).toHaveBeenCalledTimes(2);
  });

  test("negative-caches capture failures without leaking the original error", async () => {
    const capture = vi.fn(async () => {
      throw new Error("private route detail");
    });
    const service = new BrowserLocalServerThumbnailService({ capture });

    await expect(service.get("http://localhost:3000/private")).resolves.toEqual({
      status: "unavailable",
      message: "Local server preview is unavailable",
    });
    await expect(service.get("http://localhost:3000/private")).resolves.toEqual({
      status: "unavailable",
      message: "Local server preview is unavailable",
    });
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
