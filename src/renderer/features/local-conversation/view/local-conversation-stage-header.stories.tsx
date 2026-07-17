import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import type { ThreadStageActions, ThreadStageHeaderModel } from "../thread-stage-types";
import { ThreadStageHeader } from "./local-conversation-stage-header";

const model: ThreadStageHeaderModel = {
  projectId: "project-story",
  sessionId: "session-story",
  threadId: "thread-story",
  title: "Copy as Markdown parity",
  cwd: "/Users/asc/repo/nodex3",
  pinned: false,
  shortcuts: {
    togglePin: "⌘⌥P",
    rename: "⌘⌥R",
    archive: "⌘⇧A",
    openSideTask: "⌘⌥S",
  },
  showSideChatAction: true,
};

const noop = () => {};
const asyncNoop = async () => {};

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: noop,
    onModelChange: noop,
    onReasoningEffortChange: noop,
    onPermissionModeChange: noop,
    onQueueingEnabledChange: noop,
    onSendPrompt: asyncNoop,
    onOpenSideChat: asyncNoop,
    onRequestRenameThread: noop,
    onArchiveThread: asyncNoop,
    onToggleThreadPin: asyncNoop,
    onCopyConversationMarkdown: asyncNoop,
    onSteerPrompt: asyncNoop,
    onInterruptTurn: asyncNoop,
    onRespondApproval: asyncNoop,
    onRespondUserInput: asyncNoop,
    onRespondMcpElicitation: asyncNoop,
    onResolvePlanImplementationRequest: asyncNoop,
    onEnqueueQueuedFollowUp: asyncNoop,
    onRemoveQueuedFollowUp: asyncNoop,
    onReorderQueuedFollowUps: asyncNoop,
    onSendQueuedFollowUpNow: asyncNoop,
    onEditQueuedFollowUp: asyncNoop,
    onEditLastUserTurn: asyncNoop,
    onForkFromTurn: asyncNoop,
    onUnarchiveThread: asyncNoop,
    onOpenTurnDiffReview: noop,
    onConsumeComposerIntent: noop,
    onOpenThread: noop,
    onCleanBackgroundTerminals: asyncNoop,
  };
}

const meta = {
  title: "Local Conversation/Task Actions Menu",
  component: ThreadStageHeader,
  args: {
    model,
    actions: buildActions(),
    onErrorMessage: noop,
  },
  decorators: [
    (Story) => (
      <div className="h-72 w-[720px] bg-token-main-surface-primary px-4 pt-3">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ThreadStageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const MenuOpen: Story = {
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Task actions" }));
    await waitFor(() => getByRole(document.body, "menuitem", { name: "Copy" }));
  },
};

export const CopySubmenuOpen: Story = {
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Task actions" }));
    const copyItem = await waitFor(() => getByRole(document.body, "menuitem", { name: "Copy" }));
    fireEvent.keyDown(copyItem, { key: "ArrowRight" });
    await waitFor(() => getByRole(document.body, "menuitem", { name: "Copy as Markdown" }));
  },
};
