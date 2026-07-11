import { describe, expect, test } from "vitest";
import path from "node:path";
import { resolveBootstrapLocalStoreDir } from "./bootstrap-config";

function makeVirtualFs(files: Record<string, string>) {
  return {
    exists: (filePath: string) => Object.prototype.hasOwnProperty.call(files, filePath),
    readFile: (filePath: string) => files[filePath] ?? "",
  };
}

describe("resolveBootstrapLocalStoreDir", () => {
  test("prefers NODEX_DIR and resolves relative env paths from cwd", () => {
    const cwd = "/workspace/project";

    expect(resolveBootstrapLocalStoreDir({
      cwd,
      env: { NODEX_DIR: "relative-data" },
      homeDir: "/home/user",
    })).toBe(path.join(cwd, "relative-data"));
  });

  test("merges user and project config with project dir taking precedence", () => {
    const cwd = "/workspace/project/subdir";
    const files = makeVirtualFs({
      "/home/user/.nodex/config.toml": "[server]\ndir = \"~/user-data\"\n",
      "/workspace/project/.nodex/config.toml": "[server]\ndir = \"project-data\"\n",
    });

    expect(resolveBootstrapLocalStoreDir({
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

    expect(resolveBootstrapLocalStoreDir({
      cwd: "/workspace/project",
      env: {},
      homeDir: "/home/user",
      exists: files.exists,
      readFile: files.readFile,
    })).toBe("/home/user/custom-nodex");

    expect(resolveBootstrapLocalStoreDir({
      cwd: "/workspace/project",
      env: {},
      homeDir: "/home/user",
      exists: () => false,
    })).toBe("/home/user/.nodex");
  });
});
