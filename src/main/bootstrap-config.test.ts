import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveBootstrapKanbanDir } from "./bootstrap-config";

function makeVirtualFs(files: Record<string, string>) {
  return {
    exists: (filePath: string) => Object.prototype.hasOwnProperty.call(files, filePath),
    readFile: (filePath: string) => files[filePath] ?? "",
  };
}

describe("resolveBootstrapKanbanDir", () => {
  test("prefers KANBAN_DIR and resolves relative env paths from cwd", () => {
    const cwd = "/workspace/project";

    expect(resolveBootstrapKanbanDir({
      cwd,
      env: { KANBAN_DIR: "relative-data" },
      homeDir: "/home/user",
    })).toBe(path.join(cwd, "relative-data"));
  });

  test("merges user and project config with project dir taking precedence", () => {
    const cwd = "/workspace/project/subdir";
    const files = makeVirtualFs({
      "/home/user/.nodex/config.toml": "[server]\ndir = \"~/user-data\"\n",
      "/workspace/project/.nodex/config.toml": "[server]\ndir = \"project-data\"\n",
    });

    expect(resolveBootstrapKanbanDir({
      cwd,
      env: {},
      homeDir: "/home/user",
      exists: files.exists,
      readFile: files.readFile,
    })).toBe(path.join(cwd, "project-data"));
  });

  test("expands tilde config paths and falls back to home nodex dir", () => {
    const files = makeVirtualFs({
      "/home/user/.nodex/config.toml": "[server]\ndir = \"~/custom-nodex\"\n",
    });

    expect(resolveBootstrapKanbanDir({
      cwd: "/workspace/project",
      env: {},
      homeDir: "/home/user",
      exists: files.exists,
      readFile: files.readFile,
    })).toBe("/home/user/custom-nodex");

    expect(resolveBootstrapKanbanDir({
      cwd: "/workspace/project",
      env: {},
      homeDir: "/home/user",
      exists: () => false,
    })).toBe("/home/user/.nodex");
  });
});
