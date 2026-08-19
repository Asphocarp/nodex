import type { ComponentProps } from "react";

import { CalendarIcon } from "@/components/shared/icons";
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
    <svg
      {...props}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4 shrink-0 opacity-100", className)}
      style={iconStyle}
    >
      <path d="M11 1C13.2091 1 15 2.79086 15 5V6.25C15 6.66421 14.6642 7 14.25 7C13.8358 7 13.5 6.66421 13.5 6.25V6H2.5V11C2.5 12.3807 3.61929 13.5 5 13.5H6.25C6.66421 13.5 7 13.8358 7 14.25C7 14.6642 6.66421 15 6.25 15H5C2.79086 15 1 13.2091 1 11V5C1 2.79086 2.79086 1 5 1H11ZM9.53033 8.46967L11.5 10.4393L13.4697 8.46967C13.7626 8.17678 14.2374 8.17678 14.5303 8.46967C14.8232 8.76256 14.8232 9.23744 14.5303 9.53033L12.5607 11.5L14.5303 13.4697C14.8232 13.7626 14.8232 14.2374 14.5303 14.5303C14.2374 14.8232 13.7626 14.8232 13.4697 14.5303L11.5 12.5607L9.53033 14.5303C9.23744 14.8232 8.76256 14.8232 8.46967 14.5303C8.17678 14.2374 8.17678 13.7626 8.46967 13.4697L10.4393 11.5L8.46967 9.53033C8.17678 9.23744 8.17678 8.76256 8.46967 8.46967C8.76256 8.17678 9.23744 8.17678 9.53033 8.46967Z" />
    </svg>
  );
}
