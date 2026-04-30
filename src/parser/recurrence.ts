export type Recurrence = {
  type: "daily" | "weekly" | "day-of-week" | "day-of-week-range" | "interval" | "monthly-date" | null;
  dayOfWeek?: number;
  dayOfWeekRange?: number[];
  intervalAmount?: number;
  intervalUnit?: "minute" | "hour" | "day" | "week";
  monthDay?: number;
  monthInterval?: number;
};

const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const DAY_PATTERN = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun";

export function detectRecurrence(input: string): Recurrence {
  const lower = input.toLowerCase();

  const intervalMatch = lower.match(/\bevery\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|weeks?)\b/i);
  if (intervalMatch) {
    const amount = Number(intervalMatch[1]);
    const unitText = intervalMatch[2].toLowerCase();
    const intervalUnit = unitText.startsWith("m")
      ? "minute"
      : unitText.startsWith("h")
      ? "hour"
      : unitText.startsWith("d")
      ? "day"
      : "week";
    if (amount > 0) return { type: "interval", intervalAmount: amount, intervalUnit };
  }

  const monthlyDateMatch = lower.match(/\bevery\s+(?:(\d+)\s+)?months?\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b|\bevery\s+month\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (monthlyDateMatch) {
    const monthInterval = Number(monthlyDateMatch[1] || 1);
    const monthDay = Number(monthlyDateMatch[2] || monthlyDateMatch[3]);
    if (monthInterval > 0 && monthDay >= 1 && monthDay <= 31) {
      return { type: "monthly-date", monthDay, monthInterval };
    }
  }

  if (/\bevery\s+weekdays?\b/.test(lower)) {
    return { type: "day-of-week-range", dayOfWeekRange: [1, 2, 3, 4, 5] };
  }

  if (/\bevery\s+weekends?\b/.test(lower)) {
    return { type: "day-of-week-range", dayOfWeekRange: [0, 6] };
  }

  const rangeMatch = lower.match(new RegExp(`\\b(?:every\\s+)?(${DAY_PATTERN})\\s*(?:to|-)\\s*(${DAY_PATTERN})\\b`, "i"));
  if (rangeMatch) {
    const start = DAY_MAP[rangeMatch[1].toLowerCase()];
    const end = DAY_MAP[rangeMatch[2].toLowerCase()];
    if (start !== undefined && end !== undefined) {
      const days: number[] = [];
      let day = start;
      while (day !== end) {
        days.push(day);
        day = (day + 1) % 7;
      }
      days.push(end);
      return { type: "day-of-week-range", dayOfWeekRange: days };
    }
  }

  const multiDayMatch = lower.match(new RegExp(`\\bevery\\s+(${DAY_PATTERN})(?:\\s*(?:,|and)\\s*(${DAY_PATTERN}))+`, "i"));
  if (multiDayMatch) {
    const matchedDays = multiDayMatch[0]
      .replace(/^every\s+/i, "")
      .split(/\s*(?:,|and)\s*/i)
      .map((day) => DAY_MAP[day.toLowerCase()])
      .filter((day): day is number => day !== undefined);
    if (matchedDays.length > 1) {
      return { type: "day-of-week-range", dayOfWeekRange: [...new Set(matchedDays)] };
    }
  }

  const dayMatch = lower.match(new RegExp(`\\bevery\\s+(${DAY_PATTERN})\\b`, "i"));
  if (dayMatch) {
    const dayOfWeek = DAY_MAP[dayMatch[1].toLowerCase()];
    if (dayOfWeek !== undefined) return { type: "day-of-week", dayOfWeek };
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

export function buildRecurringRule(
  recurrence: Recurrence,
  parsedDate: Date,
): string | undefined {
  if (!recurrence.type) return undefined;

  const hour = parsedDate.getHours();
  const minute = parsedDate.getMinutes();

  if (recurrence.type === "interval" && recurrence.intervalAmount && recurrence.intervalUnit) {
    return `interval:${recurrence.intervalUnit}:${recurrence.intervalAmount}`;
  }

  if (recurrence.type === "monthly-date" && recurrence.monthDay) {
    return `monthly:${recurrence.monthDay}:${hour}:${minute}:${recurrence.monthInterval ?? 1}`;
  }

  if (recurrence.type === "day-of-week-range" && recurrence.dayOfWeekRange) {
    const days = [...recurrence.dayOfWeekRange].sort((a, b) => a - b).join(",");
    return `${minute} ${hour} * * ${days}`;
  }

  const dow = recurrence.type === "day-of-week"
    ? recurrence.dayOfWeek
    : recurrence.type === "weekly"
    ? parsedDate.getDay()
    : undefined;

  return `${minute} ${hour} * * ${dow ?? "*"}`;
}

export function firstStructuredRecurrenceDate(
  recurrence: Recurrence,
  nowInTz: Date,
  hours: number,
  minutes: number,
  hasExplicitTime: boolean,
): Date | null {
  if (!recurrence.type) return null;

  if (recurrence.type === "monthly-date" && recurrence.monthDay) {
    return nextMonthlyDate(nowInTz, recurrence.monthDay, hours, minutes);
  }

  if (recurrence.type === "interval") {
    if (!hasExplicitTime && recurrence.intervalAmount && recurrence.intervalUnit) {
      return addInterval(nowInTz, recurrence.intervalUnit, recurrence.intervalAmount);
    }

    const next = new Date(nowInTz.getTime());
    next.setHours(hours, minutes, 0, 0);
    if (next <= nowInTz) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  const days = recurrence.type === "daily"
    ? [0, 1, 2, 3, 4, 5, 6]
    : recurrence.type === "weekly"
    ? [nowInTz.getDay()]
    : recurrence.type === "day-of-week"
    ? [recurrence.dayOfWeek]
    : recurrence.dayOfWeekRange;

  if (!days?.length) return null;

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(nowInTz.getTime());
    candidate.setDate(nowInTz.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (days.includes(candidate.getDay()) && candidate > nowInTz) return candidate;
  }

  return null;
}

function addInterval(date: Date, unit: "minute" | "hour" | "day" | "week", amount: number): Date {
  const next = new Date(date.getTime());
  if (unit === "minute") next.setMinutes(next.getMinutes() + amount);
  if (unit === "hour") next.setHours(next.getHours() + amount);
  if (unit === "day") next.setDate(next.getDate() + amount);
  if (unit === "week") next.setDate(next.getDate() + amount * 7);
  next.setSeconds(0, 0);
  return next;
}

function nextMonthlyDate(nowInTz: Date, day: number, hours: number, minutes: number): Date | null {
  for (let monthOffset = 0; monthOffset < 14; monthOffset++) {
    const candidate = new Date(nowInTz.getFullYear(), nowInTz.getMonth() + monthOffset, day, hours, minutes, 0, 0);
    if (candidate.getDate() === day && candidate > nowInTz) return candidate;
  }
  return null;
}
