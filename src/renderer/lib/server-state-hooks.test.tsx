import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "bun:test";
import { render, settleAsyncRender } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import { TestQueryProvider } from "@/test/query";
import type {
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentSettingsSnapshot,
} from "./types";
import {
  useLocalEnvironmentConfigs,
  useSaveLocalEnvironmentConfigMutation,
} from "./use-local-environment-queries";
import { useMcpServerStatuses } from "./use-mcp-queries";

const ENVIRONMENT: WorktreeEnvironmentDefinition = {
  version: 1,
  name: "local",
  setup: { script: null, platformScripts: {} },
  cleanup: { script: null, platformScripts: {} },
  actions: [],
};

function makeConfig(configPath: string): WorktreeEnvironmentConfigRecord {
  return {
    configPath,
    fileName: configPath.split("/").at(-1) ?? "environment.json",
    state: "success",
    exists: true,
    name: "local",
    hasSetupScript: false,
    hasCleanupScript: false,
    actionCount: 0,
    parseErrorMessage: null,
    readErrorMessage: null,
    environment: ENVIRONMENT,
  };
}

function makeSnapshot(configs: WorktreeEnvironmentConfigRecord[]): WorktreeEnvironmentSettingsSnapshot {
  return {
    projectId: "project-1",
    projectName: "Project 1",
    workspacePath: "/tmp/project-1",
    configPath: configs[0]?.configPath ?? "/tmp/project-1/.codex/environment.json",
    nextConfigPath: "/tmp/project-1/.codex/environment-2.json",
    configExists: configs.length > 0,
    configs,
    environment: ENVIRONMENT,
    parseErrorMessage: null,
    readErrorMessage: null,
  };
}

function ServerStateHarness() {
  const { data: configs } = useLocalEnvironmentConfigs("project-1");
  const saveConfig = useSaveLocalEnvironmentConfigMutation();
  useMcpServerStatuses("thread-1", { enabled: false });

  return (
    <button
      type="button"
      data-testid="configs"
      onClick={() => {
        void saveConfig.mutateAsync({
          projectId: "project-1",
          configPath: "/tmp/project-1/.codex/environment.json",
          environment: ENVIRONMENT,
        });
      }}
    >
      {configs?.length ?? 0}
    </button>
  );
}

describe("server state query hooks", () => {
  let configs: WorktreeEnvironmentConfigRecord[];
  let configListCalls = 0;
  let mcpStatusCalls = 0;

  beforeEach(() => {
    configs = [makeConfig("/tmp/project-1/.codex/environment.json")];
    configListCalls = 0;
    mcpStatusCalls = 0;

    installWindowApi({
      invoke: async (channel: string) => {
        if (channel === "worktrees:environments:configs:list") {
          configListCalls += 1;
          return configs;
        }

        if (channel === "worktrees:environments:config:save") {
          configs = [
            configs[0] ?? makeConfig("/tmp/project-1/.codex/environment.json"),
            makeConfig("/tmp/project-1/.codex/environment-2.json"),
          ];
          return makeSnapshot(configs);
        }

        if (channel === "codex:mcp-server-statuses:list") {
          mcpStatusCalls += 1;
          return [];
        }

        throw new Error(`Unexpected channel: ${channel}`);
      },
      on: () => () => {},
    });
  });

  test("skips disabled MCP status queries and refreshes local environment configs after save", async () => {
    const view = render(
      <TestQueryProvider>
        <ServerStateHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("configs").textContent).toBe("1");
    });
    expect(configListCalls).toBe(1);
    expect(mcpStatusCalls).toBe(0);

    fireEvent.click(view.getByRole("button"));
    await settleAsyncRender();

    await waitFor(() => {
      expect(view.getByTestId("configs").textContent).toBe("2");
    });
    expect(configListCalls).toBe(2);
    expect(mcpStatusCalls).toBe(0);
  });
});
