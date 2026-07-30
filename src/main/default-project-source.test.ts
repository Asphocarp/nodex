import { describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectWithDefaultSource,
  findAvailableDefaultProjectSource,
  sanitizeDefaultProjectDirectoryName,
} from "./default-project-source";
import type { Project, ProjectCreateInput } from "../shared/types";

const PROJECT = { id: "project-created" } as Project;

describe("default Project sources", () => {
  test("sanitizes the generated folder name using the desktop filesystem contract", () => {
    expect(sanitizeDefaultProjectDirectoryName("")).toBe("New project");
    expect(sanitizeDefaultProjectDirectoryName("  Roadmap:*?  ")).toBe(
      "Roadmap___",
    );
    expect(sanitizeDefaultProjectDirectoryName("nested/research. ")).toBe(
      "research",
    );
    expect(sanitizeDefaultProjectDirectoryName("CON")).toBe("_CON");
    expect(sanitizeDefaultProjectDirectoryName("\u0000. ")).toBe("_");
  });

  test("allocates the first free Documents folder with numeric suffixes", async () => {
    const occupied = new Set([
      "/Users/test/Documents/New project",
      "/Users/test/Documents/New project 2",
    ]);

    await expect(
      findAvailableDefaultProjectSource(
        "/Users/test/Documents",
        "New project",
        async (candidate) => occupied.has(candidate),
      ),
    ).resolves.toBe("/Users/test/Documents/New project 3");
  });

  test("preserves explicitly selected sources without provisioning a folder", async () => {
    const createProject = vi.fn(async () => PROJECT);
    const createDirectory = vi.fn(async () => undefined);
    const initializeRepository = vi.fn(async () => undefined);
    const input: ProjectCreateInput = {
      name: "",
      sources: ["/workspace/existing"],
    };

    await expect(
      createProjectWithDefaultSource(input, {
        documentsDirectory: "/Users/test/Documents",
        createProject,
        createDirectory,
        initializeRepository,
      }),
    ).resolves.toBe(PROJECT);

    expect(createProject).toHaveBeenCalledWith(input);
    expect(createDirectory).not.toHaveBeenCalled();
    expect(initializeRepository).not.toHaveBeenCalled();
  });

  test("provisions and binds a default source when the dialog submits no folders", async () => {
    const createProject = vi.fn(async () => PROJECT);
    const createDirectory = vi.fn(async () => undefined);
    const initializeRepository = vi.fn(async () => {
      throw new Error("git unavailable");
    });

    await expect(
      createProjectWithDefaultSource(
        {
          appearance: {
            color: "black",
            marker: { kind: "icon", icon: "folder" },
          },
          name: "Launch plan",
          sources: [],
        },
        {
          documentsDirectory: "/Users/test/Documents",
          createProject,
          createDirectory,
          pathExists: async () => false,
          initializeRepository,
        },
      ),
    ).resolves.toBe(PROJECT);

    expect(createDirectory).toHaveBeenCalledWith(
      "/Users/test/Documents/Launch plan",
    );
    expect(initializeRepository).toHaveBeenCalledWith(
      "/Users/test/Documents/Launch plan",
    );
    expect(createProject).toHaveBeenCalledWith({
      appearance: {
        color: "black",
        marker: { kind: "icon", icon: "folder" },
      },
      name: "Launch plan",
      sources: ["/Users/test/Documents/Launch plan"],
    });
  });

  test("creates the default folder before persisting an unnamed Project", async () => {
    const documentsDirectory = await mkdtemp(
      join(tmpdir(), "nodex-default-project-source-"),
    );
    const createProject = vi.fn(async () => PROJECT);

    try {
      await createProjectWithDefaultSource(
        { name: "", sources: [] },
        { documentsDirectory, createProject },
      );

      const source = join(documentsDirectory, "New project");
      const sourceMetadata = await stat(source);
      expect(sourceMetadata.isDirectory()).toBe(true);
      expect(createProject).toHaveBeenCalledWith({
        name: "",
        sources: [source],
      });
    } finally {
      await rm(documentsDirectory, { recursive: true, force: true });
    }
  });
});
