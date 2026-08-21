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
import { resolveNodexProjectsDirectory } from "./nodex-projects-directory";

const PROJECT = { id: "project-created" } as Project;
const DOCUMENTS_DIRECTORY = "/Users/test/Documents";
const PROJECTS_DIRECTORY = resolveNodexProjectsDirectory(DOCUMENTS_DIRECTORY);

describe("default Project sources", () => {
  test("sanitizes the generated folder name using the desktop filesystem contract", () => {
    expect(sanitizeDefaultProjectDirectoryName("")).toBe("New project");
    expect(sanitizeDefaultProjectDirectoryName("  Roadmap:*?  ")).toBe("Roadmap___");
    expect(sanitizeDefaultProjectDirectoryName("nested/research. ")).toBe("research");
    expect(sanitizeDefaultProjectDirectoryName("CON")).toBe("_CON");
    expect(sanitizeDefaultProjectDirectoryName("\u0000. ")).toBe("_");
  });

  test("allocates the first free Documents/Nodex folder with numeric suffixes", async () => {
    const occupied = new Set([
      "/Users/test/Documents/Nodex/New project",
      "/Users/test/Documents/Nodex/New project 2",
    ]);

    await expect(
      findAvailableDefaultProjectSource(PROJECTS_DIRECTORY, "New project", async (candidate) =>
        occupied.has(candidate),
      ),
    ).resolves.toBe("/Users/test/Documents/Nodex/New project 3");
  });

  test("does not let a legacy Documents folder consume the nested name", async () => {
    const occupied = new Set(["/Users/test/Documents/Launch plan"]);

    await expect(
      findAvailableDefaultProjectSource(PROJECTS_DIRECTORY, "Launch plan", async (candidate) =>
        occupied.has(candidate),
      ),
    ).resolves.toBe("/Users/test/Documents/Nodex/Launch plan");
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
        projectsDirectory: PROJECTS_DIRECTORY,
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
          projectsDirectory: PROJECTS_DIRECTORY,
          createProject,
          createDirectory,
          pathExists: async () => false,
          initializeRepository,
        },
      ),
    ).resolves.toBe(PROJECT);

    expect(createDirectory).toHaveBeenCalledWith("/Users/test/Documents/Nodex/Launch plan");
    expect(initializeRepository).toHaveBeenCalledWith("/Users/test/Documents/Nodex/Launch plan");
    expect(createProject).toHaveBeenCalledWith({
      appearance: {
        color: "black",
        marker: { kind: "icon", icon: "folder" },
      },
      name: "Launch plan",
      sources: ["/Users/test/Documents/Nodex/Launch plan"],
    });
  });

  test("creates the default folder before persisting an unnamed Project", async () => {
    const documentsDirectory = await mkdtemp(join(tmpdir(), "nodex-default-project-source-"));
    const createProject = vi.fn(async () => PROJECT);

    try {
      const projectsDirectory = resolveNodexProjectsDirectory(documentsDirectory);
      await createProjectWithDefaultSource(
        { name: "", sources: [] },
        { projectsDirectory, createProject },
      );

      const source = join(projectsDirectory, "New project");
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
