import { toZonedTime } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { config } from "../config.js";
import { timezoneFromLocale } from "../utils/locale-tz.js";
import { parseRules } from "./rules.js";
import type { ParseContext, ParsedWhen } from "./types.js";

export type { AmbiguousDate, ParsedWhen } from "./types.js";

export async function parseWhen(
  input: string,
  userId: string,
  locale?: string,
): Promise<ParsedWhen | null> {
  const { timezone, autoDetected } = await getUserTimezone(userId, locale);
  const now = new Date();
  const ctx: ParseContext = {
    input,
    now,
    nowInTz: toZonedTime(now, timezone),
    timezone,
    autoDetected,
  };

  for (const rule of parseRules) {
    const result = rule(ctx);

    if (result.type === "parsed") return result.parsed;
    if (result.type === "invalid") return null;
    if (result.input) ctx.input = result.input;
  }

  return null;
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
