import { describe, expect, test, vi } from "vitest";
import type { ProjectSession } from "../../shared/types";
import {
  createProjectAgentDockDraftSession,
  createProjectAgentDockMaterializer,
  type ProjectAgentDockMaterializationPort,
} from "./project-agent-dock-controller";

function makeSession(id = "session-1"): ProjectSession {
  return {
    ...createProjectAgentDockDraftSession("project-1", id),
    id,
  };
}

function makePort(ensureDefaultDraft: ProjectAgentDockMaterializationPort["ensureDefaultDraft"]) {
  return {
    ensureDefaultDraft,
  } satisfies ProjectAgentDockMaterializationPort;
}

describe("Project Agent Dock materializer", () => {
  test("coalesces repeated draft materialization onto one default Session", async () => {
    const materializer = createProjectAgentDockMaterializer();
    const ensureDefaultDraft = vi.fn(async () => makeSession());
    const port = makePort(ensureDefaultDraft);
    const input = { projectId: "project-1", draftId: "draft-1" } as const;

    const [first, second] = await Promise.all([
      materializer.materialize(input, port),
      materializer.materialize(input, port),
    ]);

    expect(first.id).toBe("session-1");
    expect(second).toBe(first);
    expect(ensureDefaultDraft).toHaveBeenCalledTimes(1);
  });

  test("leaves identity and binding untouched when Session creation fails", async () => {
    const materializer = createProjectAgentDockMaterializer();
    const port = makePort(
      vi.fn(async () => {
        throw new Error("create failed");
      }),
    );

    await expect(
      materializer.materialize(
        {
          projectId: "project-1",
          draftId: "draft-1",
        },
        port,
      ),
    ).rejects.toThrow("create failed");
  });

  test("rejects a Session created outside the target Project", async () => {
    const materializer = createProjectAgentDockMaterializer();
    const port = makePort(
      vi.fn(async () => ({
        ...makeSession(),
        projectId: "project-2",
      })),
    );

    await expect(
      materializer.materialize(
        {
          projectId: "project-1",
          draftId: "draft-1",
        },
        port,
      ),
    ).rejects.toThrow("does not belong");
  });
});
