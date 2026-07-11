import type { CalendarOccurrence } from "../../shared/types";
import { getDb } from "./database";
import { listAuthoritativeCalendarOccurrences } from "./scheduled-card-store";

export {
  completeCardOccurrence,
  skipCardOccurrence,
  updateCardOccurrence,
} from "./cards";

export async function listCalendarOccurrences(
  projectId: string,
  windowStart: Date,
  windowEnd: Date,
  searchQuery?: string,
): Promise<CalendarOccurrence[]> {
  return listAuthoritativeCalendarOccurrences(getDb(), {
    projectId,
    windowStart,
    windowEnd,
    searchQuery,
  });
}
