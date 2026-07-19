export interface ReminderNotificationPayload {
  readonly projectId: string;
  readonly pageId: string;
  readonly occurrenceStart: string;
  readonly title: string;
  readonly body: string;
  readonly reminderOffsetMinutes: number;
}

export function formatReminderBody(
  occurrenceStart: Date,
  offsetMinutes: number,
): string {
  if (offsetMinutes < 0) return "Snoozed reminder";
  if (offsetMinutes === 0) return "Starts now";
  if (offsetMinutes < 60) {
    return `Starts in ${offsetMinutes} minute${offsetMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(offsetMinutes / 60);
  if (offsetMinutes % 60 === 0 && hours < 24) {
    return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.floor(offsetMinutes / (60 * 24));
  if (offsetMinutes % (60 * 24) === 0) {
    return `Starts in ${days} day${days === 1 ? "" : "s"}`;
  }
  return `Starts at ${occurrenceStart.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
