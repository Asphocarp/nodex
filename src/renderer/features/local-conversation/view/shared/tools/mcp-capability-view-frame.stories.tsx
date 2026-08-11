import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { McpAppRuntimeManagerProvider } from "@/lib/mcp-app/mcp-app-runtime-context";
import {
  McpAppRuntimeManager,
  type McpAppRuntimePort,
} from "@/lib/mcp-app/mcp-app-runtime-manager";
import type {
  McpAppRuntimeConfig,
  McpAppRuntimeStatus,
} from "@/lib/mcp-app/mcp-app-runtime";
import { McpCapabilityViewFrame } from "./mcp-capability-view-frame";
import {
  resolveMcpWidgetMetadata,
  type McpRenderableResource,
} from "./mcp-tool-call-resource-utils";

const resource: McpRenderableResource = {
  html: "<main>Calendar</main>",
  metadata: {
    ...resolveMcpWidgetMetadata(null),
    heightHint: 360,
    minFrameHeight: 240,
    prefersBorder: true,
  },
  mimeType: "text/html;profile=mcp-app",
  mode: "html",
  uri: "ui://calendar/widget",
};

const runtimeConfig: Omit<McpAppRuntimeConfig, "capabilityId" | "resource"> = {
  currentToolName: "calendar",
  server: "calendar",
  statuses: { data: [], nextCursor: null },
  threadId: "thread-story",
  toolInput: { range: "This week" },
  toolResult: { events: 3 },
};

function createStoryRuntime(status: McpAppRuntimeStatus): McpAppRuntimePort {
  const element = document.createElement("div");
  element.className = "flex h-full flex-col justify-between bg-token-main-surface-primary p-5";
  if (status === "ready") {
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "text-base font-medium text-token-foreground";
    title.textContent = "Calendar brief";
    const detail = document.createElement("p");
    detail.className = "mt-1 text-sm text-token-description-foreground";
    detail.textContent = "Three focused blocks, with a clear afternoon for implementation.";
    const button = document.createElement("button");
    button.className = "mt-5 w-fit rounded-md border border-token-border px-3 py-1.5 text-sm text-token-foreground hover:bg-token-bg-subtle";
    button.textContent = "Count: 0";
    let count = 0;
    button.addEventListener("click", () => {
      count += 1;
      button.textContent = `Count: ${count}`;
    });
    content.append(title, detail, button);
    element.append(content);
  }

  return {
    element,
    dispose: async () => element.remove(),
    getSnapshot: () => ({
      diagnostic: null,
      error: status === "error" ? new Error("The sandbox source is unavailable.") : null,
      requestedDisplayMode: null,
      status,
    }),
    setDisplayMode: () => undefined,
    subscribe: () => () => undefined,
    update: () => undefined,
  };
}

function StorySurface({
  mode = "inline",
  status,
}: {
  mode?: "inline" | "side-panel";
  status: McpAppRuntimeStatus;
}) {
  const [manager] = useState(
    () => new McpAppRuntimeManager(() => createStoryRuntime(status)),
  );
  return (
    <McpAppRuntimeManagerProvider manager={manager}>
      <div className={mode === "side-panel" ? "h-[560px] w-[380px]" : "w-[680px] p-8"}>
        <McpCapabilityViewFrame
          capabilityId={`mcp-story-${status}-${mode}`}
          mode={mode}
          resource={resource}
          runtimeConfig={runtimeConfig}
        />
      </div>
    </McpAppRuntimeManagerProvider>
  );
}

const meta = {
  title: "Workbench/Threads/MCP App Runtime",
  component: McpCapabilityViewFrame,
  args: {
    capabilityId: "storybook-mcp-app",
  },
  parameters: {
    docs: {
      description: {
        component:
          "Fake-runtime coverage for MCP App loading, ready, failure, fullscreen, and side-panel chrome. Stories never create an Electron webview.",
      },
    },
  },
} satisfies Meta<typeof McpCapabilityViewFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  render: () => <StorySurface status="ready" />,
};

export const Loading: Story = {
  render: () => <StorySurface status="loading" />,
};

export const ErrorWithRetry: Story = {
  render: () => <StorySurface status="error" />,
};

export const SidePanel: Story = {
  render: () => <StorySurface status="ready" mode="side-panel" />,
};
