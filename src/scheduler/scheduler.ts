import type { Client } from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { reminders, userSettings } from "../db/schema.js";
import {
  createReminderEmbed,
  createSnoozeButtons,
  discordTimestamp,
} from "../utils/discord.js";
import { addMinutes, addHours, addDays } from "date-fns";
import type { InferSelectModel } from "drizzle-orm";
import type { reminders } from "../db/schema.js";

function toReminderRow(row: InferSelectModel<typeof reminders>): ReminderRow {
  return {
    id: row.id,
    userId: row.userId,
    channelId: row.channelId,
    guildId: row.guildId,
    message: row.message,
    triggerAt: row.triggerAt,
    createdAt: row.createdAt,
    recurringRule: row.recurringRule,
    snoozeCount: row.snoozeCount,
    status: row.status,
  };
}

export type ReminderRow = {
  id: string;
  userId: string;
  channelId: string | null;
  guildId: string | null;
  message: string;
  triggerAt: Date;
  createdAt: Date;
  recurringRule: string | null;
  snoozeCount: number;
  status: string;
};

export class ReminderScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private client: Client | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  setClient(client: Client) {
    this.client = client;
  }

  add(row: ReminderRow) {
    this.remove(row.id);
    const delay = row.triggerAt.getTime() - Date.now();
    if (delay <= 0) {
      this.fire(row);
      return;
    }
    const timer = setTimeout(() => this.fire(row), delay);
    this.timers.set(row.id, timer);
  }

  remove(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  async start() {
    const pending = await db
      .select()
      .from(reminders)
      .where(eq(reminders.status, "pending"));

    for (const row of pending) {
      this.add(toReminderRow(row));
    }

    this.pollInterval = setInterval(() => this.poll(), 60_000);
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private async poll() {
    const now = new Date();
    const pending = await db
      .select()
      .from(reminders)
      .where(eq(reminders.status, "pending"));

    for (const row of pending) {
      if (row.triggerAt <= now && !this.timers.has(row.id)) {
        this.fire(toReminderRow(row));
      }
    }
  }

  private async fire(row: ReminderRow) {
    this.remove(row.id);

    const current = await db.query.reminders.findFirst({
      where: eq(reminders.id, row.id),
    });
    if (!current || current.status !== "pending") return;

    await db.delete(reminders).where(eq(reminders.id, row.id));
    if (!this.client) return;

    await this.sendReminder(row);
    await this.scheduleNextRecurring(row);
  }

  private async sendReminder(row: ReminderRow) {
    const tz = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, row.userId),
    });
    const timezone = tz?.timezone ?? "UTC";
    const embed = createReminderEmbed(row.message, row.triggerAt, row.createdAt, row.id, timezone);
    const buttons = createSnoozeButtons(row.id);

    try {
      const user = await this.client!.users.fetch(row.userId);
      await user.send({ embeds: [embed], components: [buttons] });
      return;
    } catch {
      // DM failed, try channel
    }

    if (!row.channelId) return;
    try {
      const channel = await this.client!.channels.fetch(row.channelId);
      if (channel?.isSendable()) {
        await channel.send({
          content: `<@${row.userId}>`,
          embeds: [embed],
          components: [buttons],
        });
      }
    } catch {
      // channel send also failed
    }
  }

  private async scheduleNextRecurring(row: ReminderRow) {
    if (!row.recurringRule) return;

    const nextTrigger = this.computeNextRecurrence(row.recurringRule, row.triggerAt);
    if (!nextTrigger) return;

    const { generateReminderId } = await import("../utils/id.js");
    const newId = generateReminderId();
    await db.insert(reminders).values({
      id: newId,
      userId: row.userId,
      channelId: row.channelId,
      guildId: row.guildId,
      message: row.message,
      triggerAt: nextTrigger,
      createdAt: new Date(),
      status: "pending",
      recurringRule: row.recurringRule,
      snoozeCount: 0,
    });
    this.add({ ...row, id: newId, triggerAt: nextTrigger, status: "pending", snoozeCount: 0 });
  }

  async handleSnooze(reminderId: string, duration: string, userId: string) {
    const reminder = await db.query.reminders.findFirst({
      where: eq(reminders.id, reminderId),
    });

    if (!reminder || reminder.userId !== userId) return null;
    if (reminder.status !== "pending" && reminder.status !== "snoozed") return null;

    const now = new Date();
    const offsets: Record<string, Date> = {
      "5m": addMinutes(now, 5),
      "15m": addMinutes(now, 15),
      "1h": addHours(now, 1),
      "1d": addDays(now, 1),
    };
    const newDate = offsets[duration];
    if (!newDate) return null;

    await db
      .update(reminders)
      .set({
        status: "pending",
        triggerAt: newDate,
        snoozeCount: reminder.snoozeCount + 1,
      })
      .where(eq(reminders.id, reminderId));

    this.add({
      ...toReminderRow(reminder),
      triggerAt: newDate,
      snoozeCount: reminder.snoozeCount + 1,
      status: "pending",
    });

    return newDate;
  }

  private computeNextRecurrence(rule: string, from: Date): Date | null {
    const parts = rule.split(" ");
    if (parts.length !== 5) return null;

    const [minuteStr, hourStr, , , dayOfWeekStr] = parts;
    const minute = Number(minuteStr);
    const hour = Number(hourStr);

    const dayOfWeekValues = dayOfWeekStr.split(",").map(Number).filter((n) => !isNaN(n));

    const next = new Date(from.getTime());
    next.setDate(next.getDate() + 1);
    next.setSeconds(0, 0);

    if (!isNaN(hour)) {
      next.setHours(hour, isNaN(minute) ? 0 : minute, 0, 0);
    } else if (!isNaN(minute)) {
      next.setMinutes(minute, 0, 0);
    }

    if (dayOfWeekValues.length > 0) {
      for (let i = 0; i < 7; i++) {
        const candidate = new Date(next.getTime());
        candidate.setDate(next.getDate() + i);
        if (dayOfWeekValues.includes(candidate.getDay())) {
          return candidate;
        }
      }
      return null;
    }

    return next;
  }
}
