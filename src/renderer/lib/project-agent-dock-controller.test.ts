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

function makePort(
  createBlank: ProjectAgentDockMaterializationPort["createBlank"],
) {
  return {
    createBlank,
    promoteDraftIdentity: vi.fn(),
    commitMaterializedSession: vi.fn(),
  } satisfies ProjectAgentDockMaterializationPort;
}

describe("Project Agent Dock materializer", () => {
  test("coalesces repeated draft materialization and commits one Session", async () => {
    const materializer = createProjectAgentDockMaterializer();
    const createBlank = vi.fn(async () => makeSession());
    const port = makePort(createBlank);
    const input = { projectId: "project-1", draftId: "draft-1" } as const;

    const [first, second] = await Promise.all([
      materializer.materialize(input, port),
      materializer.materialize(input, port),
    ]);

    expect(first.id).toBe("session-1");
    expect(second).toBe(first);
    expect(createBlank).toHaveBeenCalledTimes(1);
    expect(port.promoteDraftIdentity).toHaveBeenCalledOnce();
    expect(port.commitMaterializedSession).toHaveBeenCalledOnce();
  });

  test("leaves identity and binding untouched when Session creation fails", async () => {
    const materializer = createProjectAgentDockMaterializer();
    const port = makePort(vi.fn(async () => {
      throw new Error("create failed");
    }));

    await expect(materializer.materialize({
      projectId: "project-1",
      draftId: "draft-1",
    }, port)).rejects.toThrow("create failed");
    expect(port.promoteDraftIdentity).not.toHaveBeenCalled();
    expect(port.commitMaterializedSession).not.toHaveBeenCalled();
  });

  test("rejects a Session created outside the target Project", async () => {
    const materializer = createProjectAgentDockMaterializer();
    const port = makePort(vi.fn(async () => ({
      ...makeSession(),
      projectId: "project-2",
    })));

    await expect(materializer.materialize({
      projectId: "project-1",
      draftId: "draft-1",
    }, port)).rejects.toThrow("does not belong");
    expect(port.promoteDraftIdentity).not.toHaveBeenCalled();
    expect(port.commitMaterializedSession).not.toHaveBeenCalled();
  });
});
