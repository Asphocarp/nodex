import type { ComponentProps } from "react";

import { CalendarIcon, CalendarOverdueIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";
import type { DatabaseJsonValue } from "../../../shared/database-kernel";

export const DATABASE_DUE_DATE_MUTED_ICON_COLOR =
  "var(--database-property-icon-muted,var(--color-token-description-foreground))";
export const DATABASE_DUE_DATE_NOW_ICON_COLOR = "lch(58% 73 29)";
export const DATABASE_DUE_DATE_FUTURE_ICON_COLOR = "lch(66% 80 48)";

const calendarDateStamp = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return year * 10_000 + month * 100 + day;
};

const localDateStamp = (value: Date): number =>
  value.getFullYear() * 10_000 + (value.getMonth() + 1) * 100 + value.getDate();

export type DatabaseDueDateIconState = "calendar" | "overdue";

/** Today stays a calendar; only dates before today receive the overdue mark. */
export const databaseDueDateIconState = (
  value: DatabaseJsonValue | undefined,
  today = new Date(),
): DatabaseDueDateIconState => {
  if (typeof value !== "string") return "calendar";
  const dueStamp = calendarDateStamp(value);
  if (dueStamp === null) return "calendar";
  return dueStamp < localDateStamp(today) ? "overdue" : "calendar";
};

export const databaseDueDateIconColor = (
  value: DatabaseJsonValue | undefined,
  today = new Date(),
): string => {
  if (typeof value !== "string") return DATABASE_DUE_DATE_MUTED_ICON_COLOR;
  const dueStamp = calendarDateStamp(value);
  if (dueStamp === null) return DATABASE_DUE_DATE_MUTED_ICON_COLOR;
  const todayStamp = localDateStamp(today);
  return dueStamp <= todayStamp
    ? DATABASE_DUE_DATE_NOW_ICON_COLOR
    : DATABASE_DUE_DATE_FUTURE_ICON_COLOR;
};

/** Value-aware calendar mark shared by dense Board and List Property chips. */
export function DueDateValueIcon({
  value,
  className,
  style,
  ...props
}: ComponentProps<"svg"> & { readonly value: DatabaseJsonValue | undefined }) {
  const state = databaseDueDateIconState(value);
  const iconStyle = { color: databaseDueDateIconColor(value), ...style };
  if (state === "calendar") {
    return (
      <CalendarIcon
        {...props}
        className={cn("size-4 shrink-0 opacity-100", className)}
        style={iconStyle}
      />
    );
  }
  return (
    <CalendarOverdueIcon
      {...props}
      className={cn("size-4 shrink-0 opacity-100", className)}
      style={iconStyle}
    />
  );
}
