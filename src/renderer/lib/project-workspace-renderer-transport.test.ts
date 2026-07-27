import { afterEach, describe, expect, test, vi } from "vitest";
import { browserRendererTransport } from "./browser-renderer-transport";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Project Workspace browser transport", () => {
  test("surfaces Project update failures instead of treating error JSON as a Project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ error: "Project revision changed" }, 400)),
    );

    await expect(browserRendererTransport.invoke(
      "projects:update",
      "project-1",
      {
        expectedBindingRevision: 4,
        appearance: {
          color: "red",
          marker: { kind: "icon", icon: "heart" },
        },
      },
    )).rejects.toThrow("Project revision changed");
  });

  test("surfaces activity read failures instead of caching an empty projection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ error: "Core unavailable" }, 503)),
    );

    await expect(browserRendererTransport.invoke(
      "projects:activity-summaries",
      ["project-1"],
    )).rejects.toThrow("Core unavailable");
  });

  test("reads the actual runtime path context through HTTP", async () => {
    let requestedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return respond({
        homeDirectory: "C:\\Users\\alex",
        separator: "\\",
      });
    }));

    await expect(browserRendererTransport.invoke(
      "shell:path-context:get",
    )).resolves.toEqual({
      homeDirectory: "C:\\Users\\alex",
      separator: "\\",
    });
    expect(requestedUrl.endsWith("/api/shell/path-context")).toBe(true);
  });

  test("distinguishes a Git read failure from a genuine non-repository", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ error: "git timed out" }, 503)),
    );

    await expect(browserRendererTransport.invoke(
      "git:repository:identity",
      "/workspace/project",
    )).rejects.toThrow("git timed out");
  });
});
