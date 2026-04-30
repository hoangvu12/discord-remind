import * as chrono from "chrono-node/en";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { isValid, parse } from "date-fns";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { config } from "../config.js";
import { timezoneFromLocale } from "../utils/locale-tz.js";

export type AmbiguousDate = {
  ddmmyyyy: Date;
  mmddyyyy: Date;
  original: string;
};

export type ParsedWhen = {
  date: Date;
  relative: string;
  timezone: string;
  autoDetected: boolean;
  recurringRule?: string;
  ambiguous?: AmbiguousDate;
  dateRange?: Date[];
};

export async function parseWhen(
  input: string,
  userId: string,
  locale?: string,
): Promise<ParsedWhen | null> {
  const discordTs = input.match(/^<t:(\d+):[tTdDfFR]?>$/);
  if (discordTs) {
    const date = new Date(Number(discordTs[1]) * 1000);
    if (!isNaN(date.getTime()) && date.getTime() > Date.now()) {
      const { timezone, autoDetected } = await getUserTimezone(userId, locale);
      return { date, relative: input, timezone, autoDetected };
    }
    return null;
  }

  const { timezone, autoDetected } = await getUserTimezone(userId, locale);
  const now = new Date();
  const nowInTz = toZonedTime(now, timezone);

  const ambiguousCheck = checkAmbiguousDate(input, nowInTz, timezone);
  if (ambiguousCheck) return ambiguousCheck;

  const dateRangeCheck = checkDateRange(input, nowInTz, timezone);
  if (dateRangeCheck) return dateRangeCheck;

  const resolvedInput = resolveUnambiguousDate(input, nowInTz);

  const results = chrono.parse(resolvedInput, nowInTz, { forwardDate: true });
  if (results.length === 0) return null;

  const best = results.reduce((a, b) =>
    a.index < b.index || a.text.length > b.text.length ? a : b,
  );

  const parsedDate = best.date();
  if (isNaN(parsedDate.getTime())) return null;

  const absoluteDate = fromZonedTime(parsedDate, timezone);
  if (absoluteDate.getTime() <= now.getTime()) return null;

  const maxAhead = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  if (absoluteDate > maxAhead) return null;

  const recurringRule = buildRecurringRule(detectRecurrence(input), parsedDate);

  return {
    date: absoluteDate,
    relative: best.text,
    timezone,
    autoDetected,
    recurringRule,
  };
}

function buildRecurringRule(
  recurrence: ReturnType<typeof detectRecurrence>,
  parsedDate: Date,
): string | undefined {
  if (!recurrence.type) return undefined;

  const hour = parsedDate.getHours();
  const minute = parsedDate.getMinutes();

  if (recurrence.type === "day-of-week-range" && recurrence.dayOfWeekRange) {
    const days = recurrence.dayOfWeekRange.sort((a, b) => a - b).join(",");
    return `${minute} ${hour} * * ${days}`;
  }

  const dow = recurrence.type === "day-of-week"
    ? recurrence.dayOfWeek
    : recurrence.type === "weekly"
    ? parsedDate.getDay()
    : undefined;

  return `${minute} ${hour} * * ${dow ?? "*"}`;
}

const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function detectRecurrence(
  input: string,
): { type: "daily" | "weekly" | "day-of-week" | "day-of-week-range" | null; dayOfWeek?: number; dayOfWeekRange?: number[] } {
  const lower = input.toLowerCase();

  const rangeMatch = lower.match(
    /\b(?:every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun)\s*(?:to|-)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun)\b/i,
  );
  if (rangeMatch) {
    const start = DAY_MAP[rangeMatch[1].toLowerCase()];
    const end = DAY_MAP[rangeMatch[2].toLowerCase()];
    if (start !== undefined && end !== undefined) {
      const days: number[] = [];
      let d = start;
      while (d !== end) {
        days.push(d);
        d = (d + 1) % 7;
      }
      days.push(end);
      return { type: "day-of-week-range", dayOfWeekRange: days };
    }
  }

  const dayMatch = input.match(
    /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun)\b/i,
  );
  if (dayMatch) {
    const dow = DAY_MAP[dayMatch[1].toLowerCase()];
    if (dow !== undefined) {
      return { type: "day-of-week", dayOfWeek: dow };
    }
  }

  if (
    /\bevery\s+day\b/.test(lower) ||
    /\bdaily\b/.test(lower) ||
    /\beveryday\b/.test(lower) ||
    /\bevery\s+morning\b/.test(lower) ||
    /\bevery\s+evening\b/.test(lower) ||
    /\bevery\s+night\b/.test(lower)
  ) {
    return { type: "daily" };
  }

  if (/\bevery\s+week\b/.test(lower) || /\bweekly\b/.test(lower)) {
    return { type: "weekly" };
  }

  return { type: null };
}

const DATE_SLASH_PATTERN = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

function tryParseDate(
  first: number,
  second: number,
  year: number | undefined,
  nowInTz: Date,
): Date | null {
  const y = year ?? (first > 12 ? nowInTz.getFullYear() : nowInTz.getFullYear());
  const d = new Date(y, second - 1, first, nowInTz.getHours(), nowInTz.getMinutes());
  return isValid(d) ? d : null;
}

function checkAmbiguousDate(
  input: string,
  nowInTz: Date,
  timezone: string,
): ParsedWhen | null {
  const match = input.match(DATE_SLASH_PATTERN);
  if (!match) return null;

  const a = Number(match[1]);
  const b = Number(match[2]);
  const yearNum = match[3] ? Number(match[3]) : undefined;

  const ddmmyy = tryParseDate(a, b, yearNum, nowInTz);
  const mmddyy = tryParseDate(b, a, yearNum, nowInTz);

  if (!ddmmyy && !mmddyy) return null;

  if (ddmmyy && !mmddyy) {
    const absoluteDate = fromZonedTime(ddmmyy, timezone);
    return {
      date: absoluteDate,
      relative: input,
      timezone,
      autoDetected: false,
    };
  }

  if (mmddyy && !ddmmyy) {
    const absoluteDate = fromZonedTime(mmddyy, timezone);
    return {
      date: absoluteDate,
      relative: input,
      timezone,
      autoDetected: false,
    };
  }

  if (ddmmyy && mmddyy) {
    const absDdmmyy = fromZonedTime(ddmmyy!, timezone);
    const absMmddyy = fromZonedTime(mmddyy!, timezone);

    if (absDdmmyy.getTime() === absMmddyy.getTime()) {
      return {
        date: absDdmmyy,
        relative: input,
        timezone,
        autoDetected: false,
      };
    }

    return {
      date: absDdmmyy,
      relative: input,
      timezone,
      autoDetected: false,
      ambiguous: {
        ddmmyyyy: ddmmyy!,
        mmddyyyy: mmddyy!,
        original: input,
      },
    };
  }

  return null;
}

const DATE_RANGE_PATTERN = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:to|-)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

function checkDateRange(
  input: string,
  nowInTz: Date,
  timezone: string,
): ParsedWhen | null {
  const match = input.match(DATE_RANGE_PATTERN);
  if (!match) return null;

  const d1 = Number(match[1]);
  const m1 = Number(match[2]);
  const y1 = match[3] ? Number(match[3]) : undefined;
  const d2 = Number(match[4]);
  const m2 = Number(match[5]);
  const y2 = match[6] ? Number(match[6]) : undefined;

  const year1 = y1 ?? nowInTz.getFullYear();
  const year2 = y2 ?? year1;

  const start = new Date(year1, m1 - 1, d1, nowInTz.getHours(), nowInTz.getMinutes());
  const end = new Date(year2, m2 - 1, d2, nowInTz.getHours(), nowInTz.getMinutes());

  if (!isValid(start) || !isValid(end)) return null;
  if (end < start) return null;

  const timeMatch = input.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] || 0);
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    start.setHours(hours, minutes, 0, 0);
    end.setHours(hours, minutes, 0, 0);
  }

  const dates: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    if (current >= nowInTz) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  if (dates.length === 0) return null;

  const absoluteStart = fromZonedTime(dates[0], timezone);
  const absoluteDates = dates.map((d) => fromZonedTime(d, timezone));

  return {
    date: absoluteStart,
    relative: input,
    timezone,
    autoDetected: false,
    dateRange: absoluteDates,
  };
}

function resolveUnambiguousDate(input: string, nowInTz: Date): string {
  const match = input.match(DATE_SLASH_PATTERN);
  if (!match) return input;

  const a = Number(match[1]);
  const b = Number(match[2]);

  if (a > 12 && b <= 12) {
    const year = match[3] ? Number(match[3]) : nowInTz.getFullYear();
    const date = new Date(year, b - 1, a, nowInTz.getHours(), nowInTz.getMinutes());
    const monthNames = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December",
    ];
    const replaced = input.replace(
      match[0],
      `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
    );
    return replaced;
  }

  return input;
}

async function getUserTimezone(
  userId: string,
  locale?: string,
): Promise<{ timezone: string; autoDetected: boolean }> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (settings) return { timezone: settings.timezone, autoDetected: false };

  const detected = locale ? timezoneFromLocale(locale) : config.DEFAULT_TIMEZONE;
  return { timezone: detected, autoDetected: detected !== "UTC" };
}
