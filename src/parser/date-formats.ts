import { fromZonedTime } from "date-fns-tz";
import type { ParseContext, ParseRuleResult } from "./types.js";
import { extractExplicitTime } from "./time.js";

const DATE_SLASH_PATTERN = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;
const DATE_RANGE_PATTERN = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:to|-)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseDateRangeRule(ctx: ParseContext): ParseRuleResult {
  const match = ctx.input.match(DATE_RANGE_PATTERN);
  if (!match) return { type: "continue" };

  const start = parseSlashDateParts(match[1], match[2], match[3], ctx.nowInTz.getFullYear());
  const end = parseSlashDateParts(match[4], match[5], match[6], start?.getFullYear() ?? ctx.nowInTz.getFullYear());
  if (!start || !end || end < start) return { type: "continue" };

  const time = extractExplicitTime(ctx.input, ctx.nowInTz);
  start.setHours(time.hours, time.minutes, 0, 0);
  end.setHours(time.hours, time.minutes, 0, 0);

  const dates: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    const absolute = fromZonedTime(current, ctx.timezone);
    if (absolute > ctx.now) dates.push(absolute);
    current.setDate(current.getDate() + 1);
  }

  if (dates.length === 0) return { type: "invalid" };

  return {
    type: "parsed",
    parsed: {
      date: dates[0],
      relative: ctx.input,
      timezone: ctx.timezone,
      autoDetected: ctx.autoDetected,
      dateRange: dates,
    },
  };
}

export function ambiguousSlashDateRule(ctx: ParseContext): ParseRuleResult {
  const match = ctx.input.match(DATE_SLASH_PATTERN);
  if (!match) return { type: "continue" };

  const a = Number(match[1]);
  const b = Number(match[2]);
  const year = normalizeYear(match[3], ctx.nowInTz.getFullYear());
  const time = extractExplicitTime(ctx.input, ctx.nowInTz);

  const ddmmyyyy = createStrictDate(year, b, a, time.hours, time.minutes);
  const mmddyyyy = createStrictDate(year, a, b, time.hours, time.minutes);

  const absDdmmyyyy = ddmmyyyy ? fromZonedTime(ddmmyyyy, ctx.timezone) : null;
  const absMmddyyyy = mmddyyyy ? fromZonedTime(mmddyyyy, ctx.timezone) : null;
  const ddmmyyyyFuture = absDdmmyyyy && absDdmmyyyy > ctx.now;
  const mmddyyyyFuture = absMmddyyyy && absMmddyyyy > ctx.now;

  if (ddmmyyyyFuture && !mmddyyyyFuture) {
    return parsedSlashDate(ctx, absDdmmyyyy, ctx.input);
  }

  if (mmddyyyyFuture && !ddmmyyyyFuture) {
    return parsedSlashDate(ctx, absMmddyyyy, ctx.input);
  }

  if (!ddmmyyyyFuture || !mmddyyyyFuture) return { type: "continue" };
  if (absDdmmyyyy.getTime() === absMmddyyyy.getTime()) return { type: "continue" };

  return {
    type: "parsed",
    parsed: {
      date: absDdmmyyyy,
      relative: ctx.input,
      timezone: ctx.timezone,
      autoDetected: ctx.autoDetected,
      ambiguous: {
        ddmmyyyy: ddmmyyyy!,
        mmddyyyy: mmddyyyy!,
        original: ctx.input,
      },
    },
  };
}

function parsedSlashDate(
  ctx: ParseContext,
  date: Date,
  relative: string,
): ParseRuleResult {
  return {
    type: "parsed",
    parsed: {
      date,
      relative,
      timezone: ctx.timezone,
      autoDetected: ctx.autoDetected,
    },
  };
}

export function normalizeUnambiguousSlashDateRule(ctx: ParseContext): ParseRuleResult {
  const match = ctx.input.match(DATE_SLASH_PATTERN);
  if (!match) return { type: "continue" };

  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first <= 12 || second > 12) return { type: "continue" };

  const year = normalizeYear(match[3], ctx.nowInTz.getFullYear());
  const date = createStrictDate(year, second, first, 0, 0);
  if (!date) return { type: "continue" };

  return {
    type: "continue",
    input: ctx.input.replace(
      match[0],
      `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
    ),
  };
}

function parseSlashDateParts(
  dayText: string,
  monthText: string,
  yearText: string | undefined,
  fallbackYear: number,
): Date | null {
  const day = Number(dayText);
  const month = Number(monthText);
  const year = normalizeYear(yearText, fallbackYear);
  return createStrictDate(year, month, day, 0, 0);
}

function normalizeYear(yearText: string | undefined, fallbackYear: number): number {
  if (!yearText) return fallbackYear;
  const year = Number(yearText);
  return year < 100 ? 2000 + year : year;
}

function createStrictDate(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) {
    return null;
  }

  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}
