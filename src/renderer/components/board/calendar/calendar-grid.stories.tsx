import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import { CalendarGrid } from "./calendar-grid";

const meta = {
  title: "Board/Calendar/Grid",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;
type CalendarGridScheduledPage = ComponentProps<typeof CalendarGrid>["scheduledPages"][number];

function buildVisibleDays(count: number): Date[] {
  const start = new Date(2026, 3, 20);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function buildEvent({
  id,
  title,
  dayOffset,
  startHour,
  durationHours,
  isAllDay = false,
  pageKey,
}: {
  id: string;
  title: string;
  dayOffset: number;
  startHour: number;
  durationHours: number;
  isAllDay?: boolean;
  pageKey: string;
}): CalendarGridScheduledPage {
  const scheduledStart = new Date(2026, 3, 20 + dayOffset, startHour, 0, 0, 0);
  const scheduledEnd = new Date(scheduledStart);
  scheduledEnd.setHours(scheduledStart.getHours() + durationHours);

  return {
    id,
    pageKey,
    pageId: id,
    title,
    richTitle: plainTextToPortableRichText(title),
    description: "",
    status: "triage",
    archived: false,
    tags: [],
    created: new Date(2026, 3, 1),
    order: 0,
    columnId: "triage",
    columnName: "Triage",
    scheduledStart,
    scheduledEnd,
    isAllDay,
  };
}

function GridHarness({
  dayCount,
  narrow = false,
  denseAllDay = false,
  showPageKey = true,
}: {
  dayCount: number;
  narrow?: boolean;
  denseAllDay?: boolean;
  showPageKey?: boolean;
}) {
  const [allDayLaneHeight, setAllDayLaneHeight] = useState(denseAllDay ? 132 : 72);
  const visibleDays = buildVisibleDays(dayCount);
  const timedEvents = [
    buildEvent({ id: "design-review", pageKey: "LAB-13", title: "Design review", dayOffset: 0, startHour: 9, durationHours: 1 }),
    buildEvent({ id: "implementation", pageKey: "LAB-22", title: "Implementation block", dayOffset: 1, startHour: 11, durationHours: 2 }),
    buildEvent({ id: "release-check", pageKey: "LAB-31", title: "Release check", dayOffset: Math.min(3, dayCount - 1), startHour: 15, durationHours: 1 }),
  ];
  const allDayEvents = denseAllDay
    ? Array.from({ length: 8 }, (_, index) => buildEvent({
      id: `all-day-${index}`,
      pageKey: `LAB-${100 + index}`,
      title: `All-day focus ${index + 1}`,
      dayOffset: index % Math.max(1, dayCount),
      startHour: 0,
      durationHours: 24,
      isAllDay: true,
    }))
    : [buildEvent({ id: "launch-window", pageKey: "LAB-40", title: "Launch window", dayOffset: 2, startHour: 0, durationHours: 24, isAllDay: true })];

  return (
    <div className="h-screen bg-token-main-surface-primary p-4 text-token-foreground">
      <div className={narrow ? "h-full w-[390px]" : "h-full w-full"}>
        <CalendarGrid
          visibleDays={visibleDays}
          createRequestId={0}
          scheduledPages={[...timedEvents, ...allDayEvents]}
          showPageKey={showPageKey}
          pageStagePageId={undefined}
          onClickPage={() => undefined}
          onCreatePage={() => undefined}
          onCompleteOccurrence={() => undefined}
          onSkipOccurrence={() => undefined}
          onUpdatePageSchedule={() => undefined}
          onNavigatePrev={() => undefined}
          onNavigateNext={() => undefined}
          allDayLaneHeight={allDayLaneHeight}
          onAllDayLaneHeightChange={setAllDayLaneHeight}
        />
      </div>
    </div>
  );
}

export const Week: Story = {
  render: () => <GridHarness dayCount={7} />,
};

export const DenseAllDay: Story = {
  render: () => <GridHarness dayCount={7} denseAllDay />,
};

export const Narrow: Story = {
  render: () => <GridHarness dayCount={4} narrow denseAllDay />,
};

export const HiddenPageKeys: Story = {
  render: () => <GridHarness dayCount={7} showPageKey={false} />,
};
