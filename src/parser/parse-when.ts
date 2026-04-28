import * as chrono from "chrono-node/en";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { config } from "../config.js";
import { timezoneFromLocale } from "../utils/locale-tz.js";

export type ParsedWhen = {
  date: Date;
  relative: string;
  timezone: string;
  autoDetected: boolean;
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

  const results = chrono.parse(input, nowInTz, { forwardDate: true });
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

  return {
    date: absoluteDate,
    relative: best.text,
    timezone,
    autoDetected,
  };
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
