import { describe, expect, test } from "bun:test";
import { resolveReferencedProjectContext } from "./referenced-project-context";

describe("resolveReferencedProjectContext", () => {
  test("uses the referenced target Project instead of host shell metadata", () => {
    const context = resolveReferencedProjectContext("target-project", [
      {
        id: "host-project",
        name: "Host",
        primaryWorkspaceRoot: "/workspace/host",
      },
      {
        id: "target-project",
        name: "Target",
        primaryWorkspaceRoot: "/workspace/target",
      },
    ]);
    expect(context.projectName).toBe("Target");
    expect(context.projectWorkspacePath).toBe("/workspace/target");
  });

  test("falls back safely while the Project list is loading", () => {
    const context = resolveReferencedProjectContext("target-project", []);
    expect(context.projectName).toBe("target-project");
    expect(context.projectWorkspacePath === null).toBeTrue();
  });
});
