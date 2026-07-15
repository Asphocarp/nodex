import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from "@blocknote/react";
import { Bell, CalendarDays, Clock, FileText, Heading1, Link2, ListTree, SendHorizontal, Settings2 } from "lucide-react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { CodexThreadIcon } from "@/components/shared/icons";
import { NfmSuggestionMenuSurface, type NfmSuggestionItem } from "./nfm-slash-menu";

const SLASH_ITEMS: DefaultReactSuggestionItem[] = [
  {
    title: "Paragraph",
    subtext: "Plain text block",
    aliases: [],
    group: "Basic blocks",
    badge: "text",
    icon: <FileText size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Heading 1",
    subtext: "Large section heading",
    aliases: [],
    group: "Basic blocks",
    badge: "#",
    icon: <Heading1 size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Toggle List Inline View",
    subtext: "Embed a project's toggle-list section",
    aliases: [],
    group: "Others",
    badge: "/toggle-list",
    icon: <ListTree size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Card Mention",
    subtext: "Embed a single card with inline editing",
    aliases: [],
    group: "Others",
    badge: "/card",
    icon: <Link2 size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Thread Section",
    subtext: "Insert a runnable notebook-style prompt boundary",
    aliases: [],
    group: "Others",
    badge: "/thread",
    icon: <SendHorizontal size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Agent Config",
    subtext: "Insert a one-send plan-mode config chip",
    aliases: [],
    group: "Others",
    badge: "/agent-config",
    icon: <Settings2 size={16} />,
    onItemClick: () => undefined,
  },
];

const MENTION_ITEMS: NfmSuggestionItem[] = [
  {
    title: "Prioritize mention picker results",
    subtext: "Nodex / Running / current-project snippet match",
    tooltipContent: "Nodex / Running / current-project snippet match",
    aliases: [],
    group: "Current project",
    hint: null,
    icon: <CodexThreadIcon className="size-4" />,
    onItemClick: () => undefined,
  },
  {
    title: "Refine slash menu polish",
    subtext: "Nodex / In progress / card description match",
    tooltipContent: "Nodex / In progress / card description match",
    aliases: [],
    group: "Current project",
    hint: null,
    icon: <FileText className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    title: "Codex image input thread-section coverage",
    subtext: "Desktop",
    tooltipContent: "Desktop / Transcript search hit",
    aliases: [],
    group: "Chats",
    hint: null,
    icon: <CodexThreadIcon className="size-4" />,
    onItemClick: () => undefined,
  },
  {
    title: "Workspace restoration edge cases",
    subtext: "Desktop / Backlog",
    tooltipContent: "Desktop / Backlog / description search hit",
    aliases: [],
    group: "Cards",
    hint: null,
    icon: <FileText className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
];

const DATE_MENTION_ITEMS: NfmSuggestionItem[] = [
  {
    title: "Today",
    subtext: "@Jun 29, 2026",
    tooltipContent: "@Jun 29, 2026",
    aliases: ["today"],
    group: "Dates",
    hint: "@today",
    icon: <CalendarDays className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    title: "Now",
    subtext: "@Jun 29, 2026 2:30 PM",
    tooltipContent: "@Jun 29, 2026 2:30 PM",
    aliases: ["now"],
    group: "Dates",
    hint: "@now",
    icon: <Clock className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    title: "Remind today",
    subtext: "Inline date reminder at 9:00 AM",
    tooltipContent: "Inline date reminder at 9:00 AM",
    aliases: ["remind today"],
    group: "Reminders",
    hint: "@remind today",
    icon: <Bell className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  ...MENTION_ITEMS.slice(0, 2),
];

const LONG_ITEMS: DefaultReactSuggestionItem[] = [
  {
    title: "GPT configuration command with a very long display label",
    subtext: "Insert a one-send configuration chip with model, reasoning, and plan-mode overrides",
    aliases: [],
    group: "Others",
    icon: <Settings2 size={16} />,
    badge: "/agent-config",
    onItemClick: () => undefined,
  },
];

function NfmSuggestionMenuStorySurface(
  props: SuggestionMenuProps<DefaultReactSuggestionItem>,
) {
  return (
    <NodexTooltipProvider>
      <div className="bg-token-bg-fog p-4 text-token-foreground">
        <NfmSuggestionMenuSurface {...props} />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Kanban/Editor/NFM Slash Menu",
  component: NfmSuggestionMenuStorySurface,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "Compact Nodex-native BlockNote suggestion menu surface used by NFM slash commands and mentions.",
      },
    },
  },
} satisfies Meta<typeof NfmSuggestionMenuStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultMixedSlashMenu: Story = {
  args: {
    items: SLASH_ITEMS,
    loadingState: "loaded",
    selectedIndex: 2,
    onItemClick: () => undefined,
  },
};

export const FilteredCustomCommands: Story = {
  args: {
    items: SLASH_ITEMS.slice(2),
    loadingState: "loaded",
    selectedIndex: 3,
    onItemClick: () => undefined,
  },
};

export const CardMentionMenu: Story = {
  args: {
    items: MENTION_ITEMS,
    loadingState: "loaded",
    selectedIndex: 0,
    onItemClick: () => undefined,
  },
};

export const DateMentionMenu: Story = {
  args: {
    items: DATE_MENTION_ITEMS,
    loadingState: "loaded",
    selectedIndex: 0,
    onItemClick: () => undefined,
  },
};

export const LongLabels: Story = {
  args: {
    items: LONG_ITEMS,
    loadingState: "loaded",
    selectedIndex: 0,
    onItemClick: () => undefined,
  },
};

export const EmptyState: Story = {
  args: {
    items: [],
    loadingState: "loaded",
    selectedIndex: undefined,
    onItemClick: () => undefined,
  },
};

export const LoadingState: Story = {
  args: {
    items: [],
    loadingState: "loading",
    selectedIndex: undefined,
    onItemClick: () => undefined,
  },
};
