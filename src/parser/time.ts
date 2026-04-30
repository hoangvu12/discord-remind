export type ExtractedTime = {
  hours: number;
  minutes: number;
  hasExplicitTime: boolean;
};

export function extractExplicitTime(input: string, fallback: Date): ExtractedTime {
  const ampmMatch = input.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] || 0);
    const ampm = ampmMatch[3].toLowerCase();

    if (hours < 1 || hours > 12 || minutes > 59) {
      return fallbackTime(fallback);
    }
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    return { hours, minutes, hasExplicitTime: true };
  }

  const atMatch = input.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);
  if (atMatch) {
    const hours = Number(atMatch[1]);
    const minutes = Number(atMatch[2] || 0);
    if (hours >= 0 && hours <= 23 && minutes <= 59) {
      return { hours, minutes, hasExplicitTime: true };
    }
  }

  return fallbackTime(fallback);
}

function fallbackTime(fallback: Date): ExtractedTime {
  return {
    hours: fallback.getHours(),
    minutes: fallback.getMinutes(),
    hasExplicitTime: false,
  };
}
