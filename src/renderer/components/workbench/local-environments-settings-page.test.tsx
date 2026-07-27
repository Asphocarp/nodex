import { describe, expect, test, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import type {
  Project,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import { LocalEnvironmentsSettingsPage } from "./local-environments-settings-page";
import { NodexSettingsPageSurface as SettingsPageSurface } from "../ui/settings";

vi.mock("@/lib/use-theme", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));

const PROJECTS: Project[] = [
  {
    id: "project-alpha",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Alpha",
    description: "",
    appearance: { color: "blue", marker: { kind: "icon", icon: "terminal" } },
    sources: [{ root: "/tmp/alpha", order: 0 }],
    primaryWorkspaceRoot: "/tmp/alpha",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-01T00:00:00.000Z"),
    updated: new Date("2026-03-01T00:00:00.000Z"),
  },
  {
    id: "project-beta",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Beta",
    description: "",
    appearance: { color: "orange", marker: { kind: "icon", icon: "flask" } },
    sources: [{ root: "/tmp/beta", order: 0 }],
    primaryWorkspaceRoot: "/tmp/beta",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-02T00:00:00.000Z"),
    updated: new Date("2026-03-02T00:00:00.000Z"),
  },
];

function buildSnapshot(projectId: string, overrides?: Partial<WorktreeEnvironmentSettingsSnapshot>): WorktreeEnvironmentSettingsSnapshot {
  const project = PROJECTS.find((candidate) => candidate.id === projectId) ?? PROJECTS[0];

  return {
    projectId: project.id,
    projectName: project.name,
    workspacePath: project.primaryWorkspaceRoot ?? "",
    configPath: ".codex/environments/environment.toml",
    nextConfigPath: ".codex/environments/environment-2.toml",
    configExists: true,
    configs: [
      {
        configPath: ".codex/environments/environment.toml",
        fileName: "environment.toml",
        state: "success",
        exists: true,
        name: `${project.name} env`,
        hasSetupScript: true,
        hasCleanupScript: false,
        actionCount: 1,
        parseErrorMessage: null,
        readErrorMessage: null,
        environment: {
          version: 1,
          name: `${project.name} env`,
          setup: {
            script: "bun install",
            platformScripts: {},
          },
          cleanup: {
            script: null,
            platformScripts: {},
          },
          actions: [
            {
              id: "action-1",
              name: "Run tests",
              icon: "test",
              command: "bun test",
              platform: null,
            },
          ],
        },
      },
    ],
    environment: {
      version: 1,
      name: `${project.name} env`,
      setup: {
        script: "bun install",
        platformScripts: {},
      },
      cleanup: {
        script: null,
        platformScripts: {},
      },
      actions: [
        {
          id: "action-1",
          name: "Run tests",
          icon: "test",
          command: "bun test",
          platform: null,
        },
      ],
    },
    parseErrorMessage: null,
    readErrorMessage: null,
    ...overrides,
  };
}

function findButtonByText(container: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll("button"))
    .find((node) => node.textContent?.replace(/\s+/g, " ").trim().includes(label)) as HTMLButtonElement | null;
}

describe("LocalEnvironmentsSettingsPage", () => {
  test("presents oversized environment files as a distinct non-editable state", async () => {
    const tooLargeSnapshot = buildSnapshot("project-alpha", {
      configs: [{
        configPath: ".codex/environments/environment.toml",
        fileName: "environment.toml",
        state: "tooLarge",
        exists: true,
        name: "environment.toml",
        hasSetupScript: false,
        hasCleanupScript: false,
        actionCount: 0,
        parseErrorMessage: null,
        readErrorMessage: null,
        tooLargeMessage: "Environment file exceeds 262,144 bytes",
        environment: null,
      }],
      environment: null,
      tooLargeMessage: "Environment file exceeds 262,144 bytes",
    });
    const view = render(
      <LocalEnvironmentsSettingsPage
        open={true}
        active={true}
        projects={PROJECTS}
        activeProjectId="project-alpha"
        initialProjectId="project-alpha"
        initialConfigPath=".codex/environments/environment.toml"
        renderShell={({ title, subtitle, backSlot, children }) => (
          <SettingsPageSurface title={title} subtitle={subtitle} backSlot={backSlot}>
            {children}
          </SettingsPageSurface>
        )}
        service={{
          listConfigs: async () => tooLargeSnapshot.configs,
          readConfig: async () => tooLargeSnapshot,
          saveConfig: async () => {
            throw new Error("Oversized files cannot be edited");
          },
        }}
      />,
    );
    await settleAsyncRender();

    expect(textContent(view.container)).toContain("Local environment file is too large to load");
    expect(view.container.querySelector("textarea")).toBeNull();
  });

  test("loads each workspace config list once per mount in workspace mode", async () => {
    const listCalls: string[] = [];
    const snapshots = new Map<string, WorktreeEnvironmentSettingsSnapshot>([
      ["project-alpha", buildSnapshot("project-alpha")],
      ["project-beta", buildSnapshot("project-beta")],
    ]);

    render(
      <LocalEnvironmentsSettingsPage
        open={true}
        active={true}
        projects={PROJECTS}
        activeProjectId="project-alpha"
        initialProjectId={null}
        initialConfigPath={null}
        renderShell={({ title, subtitle, backSlot, children }) => (
          <SettingsPageSurface title={title} subtitle={subtitle} backSlot={backSlot}>
            {children}
          </SettingsPageSurface>
        )}
        service={{
          listConfigs: async (projectId) => {
            listCalls.push(projectId);
            return (snapshots.get(projectId) ?? buildSnapshot(projectId)).configs;
          },
          readConfig: async (projectId) => snapshots.get(projectId) ?? buildSnapshot(projectId),
          saveConfig: async (input) => buildSnapshot(input.projectId, {
            environment: input.environment,
          }),
        }}
      />,
    );

    await settleAsyncRender();
    expect(listCalls.length).toBe(2);

    await settleAsyncRender();
    expect(listCalls.length).toBe(2);
  });

  test("switches workspaces and saves through the injected service", async () => {
    const readCalls: Array<[string, string | null | undefined]> = [];
    const listCalls: string[] = [];
    const saveCalls: UpdateWorktreeEnvironmentConfigInput[] = [];
    const snapshots = new Map<string, WorktreeEnvironmentSettingsSnapshot>([
      ["project-alpha", buildSnapshot("project-alpha")],
      ["project-beta", buildSnapshot("project-beta")],
    ]);

    const view = render(
      <LocalEnvironmentsSettingsPage
        open={true}
        active={true}
        projects={PROJECTS}
        activeProjectId="project-alpha"
        initialProjectId="project-alpha"
        renderShell={({ title, subtitle, backSlot, children }) => (
          <SettingsPageSurface title={title} subtitle={subtitle} backSlot={backSlot}>
            {children}
          </SettingsPageSurface>
        )}
        service={{
          listConfigs: async (projectId) => {
            listCalls.push(projectId);
            return (snapshots.get(projectId) ?? buildSnapshot(projectId)).configs;
          },
          readConfig: async (projectId, configPath) => {
            readCalls.push([projectId, configPath]);
            return snapshots.get(projectId) ?? buildSnapshot(projectId);
          },
          saveConfig: async (input) => {
            saveCalls.push(input);
            const nextSnapshot = buildSnapshot(input.projectId, {
              environment: input.environment,
              configs: [
                {
                  configPath: input.configPath,
                  fileName: "environment.toml",
                  state: "success",
                  exists: true,
                  name: input.environment.name,
                  hasSetupScript: Boolean(input.environment.setup.script),
                  hasCleanupScript: Boolean(input.environment.cleanup.script),
                  actionCount: input.environment.actions.length,
                  parseErrorMessage: null,
                  readErrorMessage: null,
                  environment: input.environment,
                },
              ],
            });
            snapshots.set(input.projectId, nextSnapshot);
            return nextSnapshot;
          },
        }}
      />,
    );

    await settleAsyncRender();

    expect(textContent(view.container).includes("Alpha env")).toBe(true);
    expect(readCalls.length).toBe(1);
    expect(readCalls[0]?.[0]).toBe("project-alpha");

    const backButton = findButtonByText(view.container, "Back");
    if (!(backButton instanceof HTMLButtonElement)) {
      throw new Error("Expected a Back button when returning to the workspace list.");
    }
    fireEvent.click(backButton);
    await settleAsyncRender();
    expect(textContent(view.container).includes("Beta")).toBe(true);
    expect(listCalls.length).toBe(4);

    const betaButton = findButtonByText(view.container, "Beta");
    if (!(betaButton instanceof HTMLButtonElement)) {
      throw new Error("Expected a Beta project button in the workspace list.");
    }
    fireEvent.click(betaButton);
    await settleAsyncRender();

    expect(textContent(view.container).includes("Beta env")).toBe(true);
    expect(readCalls.length).toBe(2);
    expect(readCalls[1]?.[0]).toBe("project-beta");
    expect(listCalls.length).toBe(4);

    const editButton = findButtonByText(view.container, "Edit local environment");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Expected an Edit local environment button on the summary view.");
    }
    fireEvent.click(editButton);
    await settleAsyncRender();
    const editForm = view.container.querySelector("form");
    if (!(editForm instanceof HTMLFormElement)) {
      throw new Error("Expected an edit form before saving.");
    }
    fireEvent.submit(editForm);
    await settleAsyncRender();

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]?.projectId).toBe("project-beta");
    expect(saveCalls[0]?.configPath).toBe(".codex/environments/environment.toml");
    expect(Boolean(view.container.querySelector("form"))).toBe(false);
  });

  test("opens the action icon dropdown in edit mode", async () => {
    const view = render(
      <LocalEnvironmentsSettingsPage
        open={true}
        active={true}
        projects={PROJECTS}
        activeProjectId="project-alpha"
        initialProjectId="project-alpha"
        renderShell={({ title, subtitle, backSlot, children }) => (
          <SettingsPageSurface title={title} subtitle={subtitle} backSlot={backSlot}>
            {children}
          </SettingsPageSurface>
        )}
        service={{
          listConfigs: async (projectId) => buildSnapshot(projectId).configs,
          readConfig: async (projectId) => buildSnapshot(projectId),
          saveConfig: async (input) => buildSnapshot(input.projectId, {
            environment: input.environment,
          }),
        }}
      />,
    );

    await settleAsyncRender();

    fireEvent.click(view.getByText("Edit local environment"));
    await settleAsyncRender();

    fireEvent.pointerDown(view.getByLabelText("Action 1 icon"));
    await settleAsyncRender();

    expect(textContent(document.body).includes("Debug")).toBe(true);
    expect(textContent(document.body).includes("Test")).toBe(true);
  });
});
