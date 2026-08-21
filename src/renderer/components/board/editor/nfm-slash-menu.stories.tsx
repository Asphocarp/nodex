import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from "@blocknote/react";
import {
  Ellipsis,
  Heading1,
  Link2,
  SendHorizontal,
  Settings2,
} from "@/components/shared/icons/generic-icons";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { ThreadIcon, BellIcon, CalendarIcon, ClockIcon, PageIcon } from "@/components/shared/icons";
import { NfmSuggestionMenuSurface, type NfmSuggestionItem } from "./nfm-slash-menu";
import { StatusIcon } from "@/lib/status-presentation";

const SLASH_ITEMS: NfmSuggestionItem[] = [
  {
    title: "Paragraph",
    subtext: "Plain text block",
    aliases: [],
    group: "Basic blocks",
    badge: "text",
    icon: <PageIcon />,
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
    title: "Embed page",
    subtext: "Show a live reference to another Page",
    aliases: ["embed", "page reference"],
    group: "Others",
    hint: null,
    icon: <Link2 size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Mention a page",
    subtext: "Start the normal @ mention flow",
    aliases: ["mention", "@"],
    group: "Others",
    hint: null,
    icon: <PageIcon />,
    onItemClick: () => undefined,
  },
  {
    title: "Thread Section",
    subtext: "Insert a runnable notebook-style prompt boundary",
    aliases: ["thread"],
    group: "Others",
    hint: null,
    icon: <SendHorizontal size={16} />,
    onItemClick: () => undefined,
  },
  {
    title: "Agent Config",
    subtext: "Insert a one-send plan-mode config chip",
    aliases: ["agent-config"],
    group: "Others",
    hint: null,
    icon: <Settings2 size={16} />,
    onItemClick: () => undefined,
  },
];

const MENTION_ITEMS: NfmSuggestionItem[] = [
  {
    key: "page:mention-ranking",
    title: "Prioritize mention picker results",
    detail: null,
    titleSegments: [
      { text: "Prioritize mention", highlight: true },
      { text: " picker results", highlight: false },
    ],
    tooltipContent: "Prioritize mention picker results · NDX-42 · Build · Product / Editor",
    aliases: [],
    group: "Mention a page",
    hint: null,
    mentionRank: {
      family: "page",
      match: "exact_title",
      activeContext: true,
      sourceOrder: 0,
    },
    icon: <StatusIcon statusId="build" className="size-4" />,
    onItemClick: () => undefined,
  },
  {
    key: "page:bounded-projection",
    title: "Refine slash menu polish",
    detail: "…affected projection window stays bounded while results update…",
    detailSegments: [
      { text: "…affected ", highlight: false },
      { text: "projection", highlight: true },
      { text: " window stays bounded while results update…", highlight: false },
    ],
    tooltipContent:
      "Refine slash menu polish · Product / Editor · The affected projection window stays bounded while results update without replacing the active query.",
    aliases: [],
    group: "Mention a page",
    hint: null,
    mentionRank: {
      family: "page",
      match: "content",
      activeContext: true,
      sourceOrder: 1,
    },
    icon: <PageIcon className="icon-xs shrink-0" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    key: "mention-expand:page",
    title: "5 more results",
    aliases: [],
    group: "Mention a page",
    hint: null,
    tooltipContent: null,
    mentionUtility: { kind: "expand_section", family: "page" },
    icon: <Ellipsis className="icon-xs shrink-0" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    key: "chat:image-input",
    title: "Codex image input thread-section coverage",
    detail: null,
    tooltipContent: "Codex image input thread-section coverage · Nodex / Running",
    aliases: [],
    group: "Mention a chat",
    hint: null,
    mentionRank: {
      family: "chat",
      match: "prefix_title",
      activeContext: true,
      sourceOrder: 0,
    },
    icon: <ThreadIcon className="size-4" />,
    onItemClick: () => undefined,
  },
  {
    key: "chat:workspace-restoration",
    title: "Weekly planning",
    detail: "Desktop",
    tooltipContent: "Weekly planning · Desktop",
    aliases: [],
    group: "Mention a chat",
    hint: null,
    mentionRank: {
      family: "chat",
      match: "title",
      activeContext: false,
      sourceOrder: 1,
    },
    icon: <ThreadIcon className="size-4" />,
    onItemClick: () => undefined,
  },
];

const DATE_MENTION_ITEMS: NfmSuggestionItem[] = [
  {
    title: "Today",
    tooltipContent: "Today · Aug 16, 2026",
    aliases: ["today"],
    group: "Date",
    hint: "@today",
    mentionRank: {
      family: "temporal",
      match: "temporal_intent",
      activeContext: true,
      sourceOrder: 0,
    },
    icon: <CalendarIcon className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    title: "Now",
    tooltipContent: "Now · Aug 16, 2026 4:30 PM",
    aliases: ["now"],
    group: "Date",
    hint: "@now",
    mentionRank: {
      family: "temporal",
      match: "temporal_intent",
      activeContext: true,
      sourceOrder: 1,
    },
    icon: <ClockIcon className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  {
    title: "Remind today",
    tooltipContent: "Remind today · Aug 16, 2026 9:00 AM",
    aliases: ["remind today"],
    group: "Date",
    hint: "@remind today",
    mentionRank: {
      family: "temporal",
      match: "temporal_intent",
      activeContext: true,
      sourceOrder: 2,
    },
    icon: <BellIcon className="size-4" aria-hidden="true" />,
    onItemClick: () => undefined,
  },
  ...MENTION_ITEMS.slice(0, 2),
];

const LONG_ITEMS: NfmSuggestionItem[] = [
  {
    title: "GPT configuration command with a very long display label",
    subtext: "Insert a one-send configuration chip with model, reasoning, and plan-mode overrides",
    aliases: ["agent-config"],
    group: "Others",
    icon: <Settings2 size={16} />,
    hint: null,
    onItemClick: () => undefined,
  },
];

function NfmSuggestionMenuStorySurface(props: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  return (
    <NodexTooltipProvider>
      <div className="bg-token-bg-fog p-4 text-token-foreground">
        <NfmSuggestionMenuSurface {...props} />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Board/Editor/NFM Slash Menu",
  component: NfmSuggestionMenuStorySurface,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Compact Nodex-native BlockNote suggestion menu surface used by NFM slash commands and mentions.",
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

export const UnifiedMentionMenu: Story = {
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
