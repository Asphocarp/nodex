const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CANONICAL_DATETIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

const pad = (value: number): string => String(value).padStart(2, "0");

export const isCanonicalDataSourceDateTime = (value: string): boolean => {
  const match = CANONICAL_DATETIME_PATTERN.exec(value);
  if (!match || !parseIsoDateToLocalDate(match[1]!)) return false;
  return Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60;
};

export const parseIsoDateToLocalDate = (value: string): Date | null => {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setFullYear(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day)
    return null;
  return parsed;
};

export const formatLocalDateAsIso = (value: Date): string | null => {
  if (!Number.isFinite(value.getTime())) return null;
  const year = value.getFullYear();
  if (year < 0 || year > 9999) return null;
  return `${String(year).padStart(4, "0")}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

export const todayAsIsoDate = (): string => formatLocalDateAsIso(new Date())!;

export const datetimeDraftFromIso = (
  value: string,
): {
  readonly date: string;
  readonly time: string;
} | null => {
  if (!isCanonicalDataSourceDateTime(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return {
    date: formatLocalDateAsIso(parsed)!,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
};

export const localDateTimeToIso = (date: string, time: string): string | null => {
  const parsedDate = parseIsoDateToLocalDate(date);
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(time);
  if (!parsedDate || !timeMatch) return null;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours > 23 || minutes > 59) return null;
  const local = new Date(0);
  local.setFullYear(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
  local.setHours(hours, minutes, 0, 0);
  if (local.getHours() !== hours || local.getMinutes() !== minutes) return null;
  const iso = local.toISOString();
  return isCanonicalDataSourceDateTime(iso) ? iso : null;
};

export const dataSourceCalendarDateKey = (
  value: unknown,
  valueType: "date" | "datetime",
): string | null => {
  if (typeof value !== "string") return null;
  if (valueType === "date") {
    return parseIsoDateToLocalDate(value) ? value : null;
  }
  return datetimeDraftFromIso(value)?.date ?? null;
};
