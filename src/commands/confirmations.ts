export type PendingConfirmation = {
  userId: string;
  message: string;
  triggerAt: Date;
  channelId: string | null;
  guildId: string | null;
  createdAt: Date;
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
};

export const onboardingSessions = new Map<string, OnboardingState>();
