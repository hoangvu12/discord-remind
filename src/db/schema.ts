import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  channelId: text("channel_id"),
  guildId: text("guild_id"),
  message: text("message").notNull(),
  triggerAt: integer("trigger_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["pending", "sent", "cancelled", "snoozed"] })
    .notNull()
    .default("pending"),
  recurringRule: text("recurring_rule"),
  snoozeCount: integer("snooze_count").notNull().default(0),
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
