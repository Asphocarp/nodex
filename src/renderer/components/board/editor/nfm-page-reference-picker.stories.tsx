import type { Meta, StoryObj } from "@storybook/react-vite";

import { PageIcon } from "@/components/shared/icons";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { NfmSuggestionMenuSurface, type NfmSuggestionItem } from "./nfm-slash-menu";
import { StatusIcon } from "@/lib/status-presentation";

const ITEMS: NfmSuggestionItem[] = [
  {
    key: "page:coherent-reference-model",
    title: "Coherent Page reference model",
    detail: null,
    tooltipContent: "Coherent Page reference model · NDX-142 · Build · Nodex / Product / Editor",
    aliases: [],
    group: "Pages",
    icon: <StatusIcon statusId="build" className="size-4" />,
    onItemClick: () => undefined,
  },
  {
    key: "page:ancestor-reference-model",
    title: "An ancestor Page with a long title that remains visible without widening the picker",
    detail: "An ancestor Page cannot be embedded",
    tooltipContent: "An ancestor Page cannot be embedded · Nodex / Product",
    aliases: [],
    group: "Pages",
    disabled: true,
    icon: <PageIcon className="icon-xs shrink-0" />,
    onItemClick: () => undefined,
  },
];

const meta = {
  title: "Board/Editor/Page Reference Picker",
  component: NfmSuggestionMenuSurface,
  decorators: [
    (Story) => (
      <NodexTooltipProvider>
        <div className="min-h-80 bg-token-main-surface-primary p-10 text-token-foreground">
          <Story />
        </div>
      </NodexTooltipProvider>
    ),
  ],
  args: {
    items: ITEMS,
    loadingState: "loaded",
    itemsStale: false,
    selectedIndex: 0,
    onItemClick: () => undefined,
  },
} satisfies Meta<typeof NfmSuggestionMenuSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AvailableAndDisabled: Story = { args: {} };

export const Loading: Story = {
  args: { items: [], loadingState: "loading-initial" },
};

export const Empty: Story = {
  args: { items: [], loadingState: "loaded" },
};
