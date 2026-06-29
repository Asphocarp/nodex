import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DateMentionInlineContentView,
  dateMentionPayloadToProps,
  type DateMentionInlineContentUpdate,
  type DateMentionProps,
} from "./date-mention-chip";
import { ReadonlyNfmBlockNotePreview } from "./readonly-nfm-blocknote-preview";

function DateMentionChipStorySurface({
  initialProps,
  open = false,
}: {
  initialProps: Partial<DateMentionProps>;
  open?: boolean;
}) {
  const [props, setProps] = useState<Partial<DateMentionProps>>(initialProps);

  return (
    <div className="max-w-xl rounded-lg bg-token-bg-fog p-3 text-token-foreground">
      <span className="text-sm leading-6 text-token-foreground">
        Follow up on{" "}
        <DateMentionInlineContentView
          inlineContent={{ props }}
          updateInlineContent={(update: DateMentionInlineContentUpdate) => {
            setProps(update.props);
          }}
          defaultOpen={open}
        />{" "}
        and keep the card notes concise.
      </span>
    </div>
  );
}

const meta = {
  title: "Kanban/Editor/Date Mention Chip",
  component: DateMentionChipStorySurface,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "Focused coverage for editable NFM date mention chips rendered from `<mention-date />` inline content.",
      },
    },
  },
} satisfies Meta<typeof DateMentionChipStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Normal: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2050-06-28",
      format: "relative",
    }),
  },
};

export const PopoverOpen: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2050-06-28",
      format: "relative",
    }),
    open: true,
  },
};

export const DateRangeOpen: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2050-06-28",
      end: "2050-06-30",
      format: "ll",
    }),
    open: true,
  },
};

export const DatetimeOpen: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2050-06-28T14:30:00+08:00",
      tz: "Asia/Shanghai",
      format: "relative",
      timeFormat: "12h",
    }),
    open: true,
  },
};

export const PendingReminder: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2999-06-28",
      format: "relative",
      reminder: "day:0@09:00",
    }),
  },
};

export const OverdueReminderOpen: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2000-06-28",
      format: "relative",
      reminder: "day:0@09:00",
    }),
    open: true,
  },
};

export const ReadonlyPreview: Story = {
  args: {
    initialProps: dateMentionPayloadToProps({
      type: "dateMention",
      start: "2050-06-28",
      format: "relative",
    }),
  },
  render: () => (
    <div className="w-[28rem] rounded-lg bg-token-bg-fog p-3 text-token-foreground">
      <ReadonlyNfmBlockNotePreview
        content={'Captured note with <mention-date start="2050-06-28" format="relative" /> inside readonly history.'}
        projectId="project-1"
        cardId="card-1"
        historyId={1}
      />
    </div>
  ),
};
