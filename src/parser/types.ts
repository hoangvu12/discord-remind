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

export type ParseContext = {
  input: string;
  now: Date;
  nowInTz: Date;
  timezone: string;
  autoDetected: boolean;
};

export type ParseRuleResult =
  | { type: "parsed"; parsed: ParsedWhen }
  | { type: "continue"; input?: string }
  | { type: "invalid" };

export type ParseRule = (ctx: ParseContext) => ParseRuleResult;
