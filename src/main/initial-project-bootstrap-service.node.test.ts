import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { extractPlainText } from "../shared/nfm";
import type { Project } from "../shared/types";
import type {
  DesktopInitialProjectCreateInput,
  DesktopInitialProjectCreateResult,
  DesktopProjectWorkspacePort,
} from "./core-client/project-workspace-adapter";
import { InitialProjectBootstrapService } from "./initial-project-bootstrap-service";
import { resolveInitialProjectJournalPath } from "./initial-project/initial-project-journal-store";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "nodex-initial-project-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createIdFactory(): () => string {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ];
  return () => {
    const id = ids.shift();
    if (!id) throw new Error("Initial Project test exhausted its identities");
    return id;
  };
}

class FakeProjectWorkspace {
  status: "empty" | "ready" = "empty";
  project: Project | null = null;
  readonly createInputs: DesktopInitialProjectCreateInput[] = [];
  competingWinner = false;

  readonly port = {
    readProjectBootstrap: async () => ({ status: this.status }),
    getProject: async (projectId: string) =>
      this.project?.id === projectId ? this.project : null,
    createInitialProject: async (
      input: DesktopInitialProjectCreateInput,
    ): Promise<DesktopInitialProjectCreateResult> => {
      this.createInputs.push(structuredClone(input));
      if (this.competingWinner) {
        this.status = "ready";
        this.project = makeProject({
          id: "project:competing-winner",
          sourceRoot: "/workspace/competing-winner",
        });
        throw new Error("initial Project lost the catalog race");
      }
      if (!this.project) {
        this.project = makeProject({
          id: input.projectId,
          sourceRoot: input.sources?.[0] ?? "",
        });
        this.status = "ready";
      }
      return {
        project: this.project,
        starterSessionId: "session:starter",
      };
    },
  } as unknown as DesktopProjectWorkspacePort;
}

function makeProject(input: {
  id: string;
  sourceRoot: string;
}): Project {
  return {
    id: input.id,
    libraryId: "library:test",
    databaseId: "database:default",
    defaultDatabaseViewId: "view:default",
    lifecycle: "active",
    bindingRevision: 1,
    name: "My Project",
    description: "",
    appearance: {
      color: "black",
      marker: { kind: "icon", icon: "folder" },
    },
    sources: [{ root: input.sourceRoot, order: 0 }],
    primaryWorkspaceRoot: input.sourceRoot,
    pinned: true,
    pinnedOrder: 0,
    created: new Date("2026-07-31T00:00:00.000Z"),
    updated: new Date("2026-07-31T00:00:00.000Z"),
  };
}

function createService(input: {
  root: string;
  workspace: FakeProjectWorkspace;
  createId?: () => string;
}): InitialProjectBootstrapService {
  return new InitialProjectBootstrapService({
    projectWorkspace: input.workspace.port,
    projectsDirectory: join(input.root, "workspace"),
    journalPath: resolveInitialProjectJournalPath(join(input.root, ".nodex")),
    createId: input.createId,
  });
}

describe("InitialProjectBootstrapService", () => {
  test("creates My Project with source-aware welcome content and durable presentation", async () => {
    const root = createTemporaryDirectory();
    const workspace = new FakeProjectWorkspace();
    const presentations: unknown[] = [];
    const service = createService({
      root,
      workspace,
      createId: createIdFactory(),
    });

    await service.ensureInitialProject({
      onProvisioned: async (presentation) => {
        presentations.push(presentation);
      },
    });

    const input = workspace.createInputs[0];
    const sourceRoot = join(root, "workspace", "My Project");
    expect(input).toMatchObject({
      name: "My Project",
      sources: [sourceRoot],
      starterPage: {
        titleMarkdown: "Welcome to Nodex",
      },
    });
    expect(extractPlainText(input?.starterPage.nfm ?? "")).toContain(sourceRoot);
    expect(presentations).toEqual([{
      projectId: input?.projectId,
      starterSessionId: "session:starter",
      defaultDatabaseViewId: "view:default",
      starterPageId: input?.starterPage.pageId,
      starterPageTitle: "Welcome to Nodex",
    }]);
    expect(readdirSync(sourceRoot)).toEqual([]);
    expect(existsSync(resolveInitialProjectJournalPath(
      join(root, ".nodex"),
    ))).toBe(false);
  });

  test("replays the exact operation after Core commit when presentation fails", async () => {
    const root = createTemporaryDirectory();
    const workspace = new FakeProjectWorkspace();
    const first = createService({
      root,
      workspace,
      createId: createIdFactory(),
    });

    await expect(first.ensureInitialProject({
      onProvisioned: async () => {
        throw new Error("window session write failed");
      },
    })).rejects.toThrow("window session write failed");
    const journalPath = resolveInitialProjectJournalPath(join(root, ".nodex"));
    expect(existsSync(journalPath)).toBe(true);

    const recoveredPresentations: unknown[] = [];
    const recovered = createService({ root, workspace });
    await recovered.ensureInitialProject({
      onProvisioned: async (presentation) => {
        recoveredPresentations.push(presentation);
      },
    });

    expect(workspace.createInputs).toHaveLength(2);
    expect(workspace.createInputs[1]).toEqual(workspace.createInputs[0]);
    expect(recoveredPresentations).toHaveLength(1);
    expect(existsSync(journalPath)).toBe(false);
    expect(readdirSync(join(root, "workspace", "My Project"))).toEqual([]);
  });

  test("uses a collision-safe folder without taking over existing content", async () => {
    const root = createTemporaryDirectory();
    const projectsDirectory = join(root, "workspace");
    mkdirSync(join(projectsDirectory, "My Project"), { recursive: true });
    const workspace = new FakeProjectWorkspace();
    const service = createService({
      root,
      workspace,
      createId: createIdFactory(),
    });

    await service.ensureInitialProject({
      onProvisioned: async () => {},
    });

    expect(workspace.createInputs[0]?.sources).toEqual([
      join(projectsDirectory, "My Project 2"),
    ]);
    expect(readdirSync(join(projectsDirectory, "My Project"))).toEqual([]);
  });

  test("accepts a competing initial Project and retains its unused directory", async () => {
    const root = createTemporaryDirectory();
    const workspace = new FakeProjectWorkspace();
    workspace.competingWinner = true;
    const service = createService({
      root,
      workspace,
      createId: createIdFactory(),
    });
    let presented = false;

    await service.ensureInitialProject({
      onProvisioned: async () => {
        presented = true;
      },
    });

    expect(presented).toBe(false);
    expect(existsSync(join(root, "workspace", "My Project"))).toBe(true);
    expect(readdirSync(join(root, "workspace", "My Project"))).toEqual([]);
    expect(existsSync(resolveInitialProjectJournalPath(
      join(root, ".nodex"),
    ))).toBe(false);
  });
});
