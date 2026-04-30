import type { ParsedWhen } from "../parser/parse-when.js";

export type PendingConfirmation = {
  userId: string;
  message: string;
  triggerAt: Date;
  channelId: string | null;
  guildId: string | null;
  createdAt: Date;
  recurringRule?: string | null;
  dateRange?: Date[];
};

export const pendingConfirmations = new Map<string, PendingConfirmation>();

export type PaginatedListState = {
  userId: string;
  reminders: {
    id: string;
    message: string;
    triggerAt: Date;
  }[];
  page: number;
};

export const paginatedLists = new Map<string, PaginatedListState>();

export type OnboardingState = {
  userId: string;
  detectedTimezone: string;
  pendingReminder?: {
    whenInput: string;
    message: string;
    parsed: ParsedWhen;
  };
};

export const onboardingSessions = new Map<string, OnboardingState>();

export type AmbiguousResolution = {
  userId: string;
  message: string;
  whenInput: string;
  timezone: string;
  ddmmyyyy: Date;
  mmddyyyy: Date;
};

export const ambiguousResolutions = new Map<string, AmbiguousResolution>();
