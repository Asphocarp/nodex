import { createHash } from "node:crypto";
import { RRule, RRuleSet, rrulestr } from "rrule";
import type { CodexScheduledAutomation } from "../../shared/types";

export const DEFAULT_CODEX_SCHEDULED_AUTOMATION_RRULE = "FREQ=HOURLY;INTERVAL=24;BYMINUTE=0";
export const CODEX_SCHEDULED_AUTOMATION_JITTER_MAX_SECONDS = 120;

const BASIC_INTERVAL_KEYS = new Set(["FREQ", "INTERVAL", "DTSTART", "TZID"]);
const HOURLY_INTERVAL_KEYS = new Set([...BASIC_INTERVAL_KEYS, "BYDAY", "BYMINUTE"]);
const WALL_CLOCK_KEYS = new Set([...HOURLY_INTERVAL_KEYS, "BYHOUR", "BYSECOND"]);

interface ParsedRruleParts {
  text: string;
  hasDtstart: boolean;
  options: Map<string, string>;
}

interface ClockTime {
  hour: number;
  minute: number;
}

const WEEKDAY_TO_JS_DAY: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 0,
};

export function normalizeCodexScheduledAutomationRrule(rrule: string | null | undefined): string {
  const normalized = rrule?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : DEFAULT_CODEX_SCHEDULED_AUTOMATION_RRULE;
}

export function computeCodexScheduledAutomationJitterMs(input: {
  automationId: string;
  nextRunAt: number;
  jitterSalt: string;
}): number {
  return (
    (createHash("sha256")
      .update(`${input.jitterSalt}:${input.automationId}:${input.nextRunAt}`)
      .digest()
      .readUInt32BE(0) %
      CODEX_SCHEDULED_AUTOMATION_JITTER_MAX_SECONDS) *
    1_000
  );
}

export function computeCodexScheduledAutomationIntervalMs(
  rrule: string | null | undefined,
): number | null {
  const parsed = parseRruleParts(rrule);
  const freq = parsed.options.get("FREQ");
  const interval = parsePositiveInteger(parsed.options.get("INTERVAL")) ?? 1;

  if (freq === "MINUTELY" && hasOnlyKeys(parsed.options, BASIC_INTERVAL_KEYS)) {
    return interval * 60_000;
  }

  if (freq !== "HOURLY" || !hasOnlyKeys(parsed.options, HOURLY_INTERVAL_KEYS)) return null;

  const byMinute = parseIntegerList(parsed.options.get("BYMINUTE"));
  if (byMinute.length > 0 && (byMinute.length !== 1 || byMinute[0] !== 0)) return null;

  const byDay = parseWeekdayList(parsed.options.get("BYDAY"));
  if (parsed.options.has("BYDAY") && byDay.length !== 7) return null;

  return interval * 60 * 60_000;
}

export function shouldJitterCodexScheduledAutomation(input: {
  automation: Pick<CodexScheduledAutomation, "id" | "kind" | "rrule">;
}): boolean {
  const normalizedRrule = normalizeCodexScheduledAutomationRrule(input.automation.rrule);
  if (
    input.automation.kind === "heartbeat" &&
    computeCodexScheduledAutomationIntervalMs(normalizedRrule) !== null
  ) {
    return false;
  }

  const parsed = parseRruleParts(normalizedRrule);
  if (parsePositiveInteger(parsed.options.get("COUNT")) === 1) return false;

  const freq = parsed.options.get("FREQ");
  return freq === "HOURLY" || freq === "DAILY" || freq === "WEEKLY";
}

export function computeCodexScheduledAutomationNextRunAt(input: {
  automation: Pick<CodexScheduledAutomation, "id" | "kind" | "rrule">;
  now: number;
  jitterSalt: string;
}): number | null {
  const normalizedRrule = normalizeCodexScheduledAutomationRrule(input.automation.rrule);
  const nextRunAt = computeNextRunWithoutJitter(normalizedRrule, input.now);
  if (nextRunAt === null) return null;
  if (
    !shouldJitterCodexScheduledAutomation({
      automation: {
        ...input.automation,
        rrule: normalizedRrule,
      },
    })
  ) {
    return nextRunAt;
  }
  return (
    nextRunAt +
    computeCodexScheduledAutomationJitterMs({
      automationId: input.automation.id,
      nextRunAt,
      jitterSalt: input.jitterSalt,
    })
  );
}

export function reconcileCodexScheduledAutomationRuntimeState(input: {
  automation: CodexScheduledAutomation;
  mirror: CodexScheduledAutomation | null;
  now: number;
  jitterSalt: string;
}): CodexScheduledAutomation {
  const rrule = normalizeCodexScheduledAutomationRrule(input.automation.rrule);
  const mirrorRrule = input.mirror
    ? normalizeCodexScheduledAutomationRrule(input.mirror.rrule)
    : null;
  const scheduleChanged =
    !input.mirror || mirrorRrule !== rrule || input.mirror.status !== input.automation.status;
  const lastRunAt = input.mirror?.lastRunAt ?? input.automation.lastRunAt;
  let nextRunAt = input.mirror?.nextRunAt ?? input.automation.nextRunAt;

  if (input.automation.status === "ACTIVE") {
    if (nextRunAt === null || scheduleChanged) {
      nextRunAt = computeCodexScheduledAutomationNextRunAt({
        automation: {
          id: input.automation.id,
          kind: input.automation.kind,
          rrule,
        },
        now: input.now,
        jitterSalt: input.jitterSalt,
      });
    }
  } else {
    nextRunAt = null;
  }

  return {
    ...input.automation,
    rrule,
    nextRunAt,
    lastRunAt,
  };
}

export function listDueCodexScheduledAutomations(
  automations: readonly CodexScheduledAutomation[],
  now: number,
  limit = 10,
): CodexScheduledAutomation[] {
  return automations
    .filter((automation) => automation.status === "ACTIVE")
    .filter((automation) => automation.nextRunAt !== null && automation.nextRunAt <= now)
    .sort((left, right) => (left.nextRunAt ?? 0) - (right.nextRunAt ?? 0))
    .slice(0, limit);
}

function computeNextRunWithoutJitter(rrule: string, now: number): number | null {
  const wallClock = computeWallClockNextRun(rrule, now);
  if (wallClock !== null) return wallClock;

  const interval = computeIntervalNextRun(rrule, now);
  if (interval !== null) return interval;

  try {
    const ruleText = injectDtstartIfMissing(rrule, now);
    return (
      (rrulestr(ruleText, { forceset: true }) as RRuleSet).after(new Date(now), false)?.getTime() ??
      null
    );
  } catch {
    return null;
  }
}

function computeWallClockNextRun(rrule: string, now: number): number | null {
  let ruleSet: RRuleSet;
  try {
    ruleSet = rrulestr(rrule, { forceset: true }) as RRuleSet;
  } catch {
    return null;
  }

  const rule = firstSimpleRrule(ruleSet);
  if (!rule) return null;

  const options = rule.options;
  const origOptions = normalizeOrigOptions(rule.origOptions as Record<string, unknown>);
  const interval =
    typeof options.interval === "number" && options.interval > 0 ? options.interval : 1;
  if (interval !== 1) return null;
  if (!hasOnlyKeys(origOptions, WALL_CLOCK_KEYS)) return null;
  if (!isMissingOrZeroSecond(options.bysecond)) return null;
  if (options.freq !== RRule.DAILY && options.freq !== RRule.WEEKLY) return null;

  const clockTimes = options.byhour.flatMap((hour) =>
    options.byminute.map((minute) => ({ hour, minute })),
  );
  if (clockTimes.length === 0) return null;

  const weekdays = parseByweekdayOptions(options.byweekday);
  return Math.min(
    ...clockTimes.map((clockTime) =>
      options.freq === RRule.DAILY && weekdays.length === 0
        ? nextDailyClockTime(now, clockTime)
        : nextWeeklyClockTime(now, clockTime, weekdays),
    ),
  );
}

function computeIntervalNextRun(rrule: string, now: number): number | null {
  const parsed = parseRruleParts(rrule);
  const freq = parsed.options.get("FREQ");
  const interval = parsePositiveInteger(parsed.options.get("INTERVAL")) ?? 1;
  const floor = floorToMinute(now);

  if (freq === "MINUTELY" && hasOnlyKeys(parsed.options, BASIC_INTERVAL_KEYS)) {
    return floor + interval * 60_000;
  }

  if (freq !== "HOURLY" || !hasOnlyKeys(parsed.options, HOURLY_INTERVAL_KEYS)) return null;

  const byMinute = parseIntegerList(parsed.options.get("BYMINUTE"));
  if (byMinute.length > 0 && (byMinute.length !== 1 || byMinute[0] !== 0)) return null;
  const minute = byMinute[0] ?? new Date(floor).getMinutes();
  let candidate = new Date(floor);
  candidate.setMinutes(minute, 0, 0);
  while (candidate.getTime() <= now) {
    candidate = new Date(candidate.getTime() + interval * 60 * 60_000);
  }
  return candidate.getTime();
}

function parseRruleParts(rrule: string | null | undefined): ParsedRruleParts {
  const text = normalizeCodexScheduledAutomationRrule(rrule);
  const options = new Map<string, string>();
  let hasDtstart = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    if (upper.startsWith("DTSTART")) {
      hasDtstart = true;
      continue;
    }

    const ruleBody = upper.startsWith("RRULE:") ? trimmed.slice(trimmed.indexOf(":") + 1) : trimmed;
    for (const part of ruleBody.split(";")) {
      const [rawKey, ...rawValueParts] = part.split("=");
      const key = rawKey?.trim().toUpperCase();
      const value = rawValueParts.join("=").trim().toUpperCase();
      if (!key || !value) continue;
      options.set(key, value);
    }
  }

  return {
    text,
    hasDtstart,
    options,
  };
}

function injectDtstartIfMissing(rrule: string, now: number): string {
  const parsed = parseRruleParts(rrule);
  if (parsed.hasDtstart || /(^|[;\n])DTSTART(?:;TZID=[^:=]+)?[:=]/i.test(parsed.text))
    return parsed.text;
  return `${RRule.optionsToString({ dtstart: new Date(floorToMinute(now)) })}\n${parsed.text}`;
}

function firstSimpleRrule(ruleSet: RRuleSet): RRule | null {
  const rules = ruleSet.rrules();
  if (rules.length !== 1) return null;
  if (ruleSet.rdates().length !== 0) return null;
  if (ruleSet.exrules().length !== 0) return null;
  if (ruleSet.exdates().length !== 0) return null;
  const rule = rules[0] ?? null;
  if (!rule) return null;
  const origOptions = normalizeOrigOptions(rule.origOptions as Record<string, unknown>);
  return origOptions.has("DTSTART") ? null : rule;
}

function normalizeOrigOptions(origOptions: Record<string, unknown>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(origOptions)) {
    if (value === undefined || value === null) continue;
    result.set(key.toUpperCase(), String(value));
  }
  return result;
}

function hasOnlyKeys(options: Map<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  for (const key of options.keys()) {
    if (!allowedKeys.has(key)) return false;
  }
  return true;
}

function isMissingOrZeroSecond(bysecond: readonly number[] | null | undefined): boolean {
  if (!bysecond) return true;
  return bysecond.length === 1 && bysecond[0] === 0;
}

function parseByweekdayOptions(value: number[] | number | null): number[] {
  const values = Array.isArray(value) ? value : value === null ? [] : [value];
  return values
    .map((weekday) =>
      Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? (weekday + 1) % 7 : null,
    )
    .filter((weekday): weekday is number => weekday !== null);
}

function parseWeekdayList(value: string | undefined): number[] {
  if (!value) return [];
  const weekdays: number[] = [];
  for (const part of value.split(",")) {
    const weekday = WEEKDAY_TO_JS_DAY[part.trim().slice(-2)];
    if (weekday === undefined || weekdays.includes(weekday)) continue;
    weekdays.push(weekday);
  }
  return weekdays;
}

function parseIntegerList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part));
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nextDailyClockTime(now: number, clockTime: ClockTime): number {
  const date = new Date(now);
  const candidate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    clockTime.hour,
    clockTime.minute,
    0,
    0,
  );
  if (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 1);
  return candidate.getTime();
}

function nextWeeklyClockTime(
  now: number,
  clockTime: ClockTime,
  weekdays: readonly number[],
): number {
  const date = new Date(now);
  const today = date.getDay();
  const allowedWeekdays = weekdays.length > 0 ? weekdays : [0, 1, 2, 3, 4, 5, 6];

  for (let offset = 0; offset <= 7; offset += 1) {
    const weekday = (today + offset) % 7;
    if (!allowedWeekdays.includes(weekday)) continue;
    const candidate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + offset,
      clockTime.hour,
      clockTime.minute,
      0,
      0,
    );
    if (candidate.getTime() > now) return candidate.getTime();
  }

  return now;
}

function floorToMinute(timestamp: number): number {
  const date = new Date(timestamp);
  date.setSeconds(0, 0);
  return date.getTime();
}
