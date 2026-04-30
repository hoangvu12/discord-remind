import * as chrono from "chrono-node/en";
import { fromZonedTime } from "date-fns-tz";
import type { ParseContext, ParseRule, ParseRuleResult } from "./types.js";
import { ambiguousSlashDateRule, normalizeUnambiguousSlashDateRule, parseDateRangeRule } from "./date-formats.js";
import { buildRecurringRule, detectRecurrence, firstStructuredRecurrenceDate } from "./recurrence.js";
import { extractExplicitTime } from "./time.js";

const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export const parseRules: ParseRule[] = [
  parseDiscordTimestampRule,
  parseDateRangeRule,
  ambiguousSlashDateRule,
  normalizeUnambiguousSlashDateRule,
  parseStructuredRecurrenceRule,
  parseChronoRule,
];

function parseDiscordTimestampRule(ctx: ParseContext): ParseRuleResult {
  const match = ctx.input.match(/^<t:(\d+):[tTdDfFR]?>$/);
  if (!match) return { type: "continue" };

  const date = new Date(Number(match[1]) * 1000);
  if (isNaN(date.getTime()) || date <= ctx.now) return { type: "invalid" };

  return {
    type: "parsed",
    parsed: {
      date,
      relative: ctx.input,
      timezone: ctx.timezone,
      autoDetected: ctx.autoDetected,
    },
  };
}

function parseStructuredRecurrenceRule(ctx: ParseContext): ParseRuleResult {
  const recurrence = detectRecurrence(ctx.input);
  if (!recurrence.type) return { type: "continue" };

  const time = extractExplicitTime(ctx.input, ctx.nowInTz);
  const firstDate = firstStructuredRecurrenceDate(
    recurrence,
    ctx.nowInTz,
    time.hours,
    time.minutes,
    time.hasExplicitTime,
  );
  if (!firstDate) return { type: "continue" };

  const absoluteDate = fromZonedTime(firstDate, ctx.timezone);
  if (absoluteDate <= ctx.now) return { type: "invalid" };

  return {
    type: "parsed",
    parsed: {
      date: absoluteDate,
      relative: ctx.input,
      timezone: ctx.timezone,
      autoDetected: ctx.autoDetected,
      recurringRule: buildRecurringRule(recurrence, firstDate),
    },
  };
}

function parseChronoRule(ctx: ParseContext): ParseRuleResult {
  const results = chrono.parse(ctx.input, ctx.nowInTz, { forwardDate: true });
  if (results.length === 0) return { type: "invalid" };

  const best = results.reduce((a, b) =>
    a.index < b.index || a.text.length > b.text.length ? a : b,
  );

  const parsedDate = best.date();
  if (isNaN(parsedDate.getTime())) return { type: "invalid" };

  const absoluteDate = fromZonedTime(parsedDate, ctx.timezone);
  if (absoluteDate <= ctx.now) return { type: "invalid" };

  const maxAhead = new Date(ctx.now.getTime() + MAX_AHEAD_MS);
  if (absoluteDate > maxAhead) return { type: "invalid" };

  return {
    type: "parsed",
    parsed: {
      date: absoluteDate,
      relative: best.text,
      timezone: ctx.timezone,
      autoDetected: ctx.autoDetected,
      recurringRule: buildRecurringRule(detectRecurrence(ctx.input), parsedDate),
    },
  };
}
