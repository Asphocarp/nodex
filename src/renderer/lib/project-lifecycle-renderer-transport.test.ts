import { afterEach, describe, expect, test, vi } from "vitest";
import { browserRendererTransport } from "./browser-renderer-transport";

function projectJson(lifecycle: "active" | "archived" = "active") {
  return {
    id: "project-1",
    libraryId: "library-1",
    databaseId: "database-1",
    lifecycle,
    bindingRevision: 1,
    name: "Alpha",
    description: "",
    sources: [{ root: "/workspace/alpha", order: 0 }],
    primaryWorkspaceRoot: "/workspace/alpha",
    pinned: false,
    pinnedOrder: null,
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
  };
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Project lifecycle browser transport", () => {
  test.each([
    [200, { kind: "updated", project: projectJson("archived"), changed: true }, "updated"],
    [409, {
      kind: "blocked",
      project: projectJson(),
      blockers: [{ kind: "active-turn", threadId: "thread-1", label: null }],
    }, "blocked"],
    [404, { kind: "not-found" }, "not-found"],
  ] as const)("decodes a typed %s lifecycle response", async (status, body, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(body, status)));

    const result = await browserRendererTransport.invoke(
      "projects:set-lifecycle",
      "project-1",
      { lifecycle: "archived" },
    );

    expect(result).toMatchObject({ kind });
    if (kind === "updated" && result && typeof result === "object" && "project" in result) {
      expect((result.project as { created: unknown }).created).toBeInstanceOf(Date);
    }
  });

  test("rejects malformed successful lifecycle payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ kind: "updated" }, 200)));

    await expect(browserRendererTransport.invoke(
      "projects:set-lifecycle",
      "project-1",
      { lifecycle: "archived" },
    )).rejects.toThrow();
  });

  test("surfaces unexpected server failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: "Core unavailable" }, 503)));

    await expect(browserRendererTransport.invoke(
      "projects:set-lifecycle",
      "project-1",
      { lifecycle: "archived" },
    )).rejects.toThrow("Core unavailable");
  });
});
