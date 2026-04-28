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
      this.add({
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
      });
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
    const overdue = await db
      .select()
      .from(reminders)
      .where(eq(reminders.status, "pending"));

    for (const row of overdue) {
      if (row.triggerAt <= now && !this.timers.has(row.id)) {
        this.fire({
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
        });
      }
    }
  }

  private async fire(row: ReminderRow) {
    this.remove(row.id);

    await db
      .update(reminders)
      .set({ status: "sent" })
      .where(eq(reminders.id, row.id));

    if (!this.client) return;

    const tz = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, row.userId),
    });
    const timezone = tz?.timezone ?? "UTC";

    try {
      const user = await this.client.users.fetch(row.userId);
      const embed = createReminderEmbed(row.message, row.triggerAt, row.createdAt, row.id, timezone);
      const buttons = createSnoozeButtons(row.id);

      await user.send({ embeds: [embed], components: [buttons] });
    } catch {
      if (row.channelId) {
        try {
          const channel = await this.client.channels.fetch(row.channelId);
          if (channel?.isSendable()) {
            const embed = createReminderEmbed(row.message, row.triggerAt, row.createdAt, row.id, timezone);
            const buttons = createSnoozeButtons(row.id);
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
    }

    if (row.recurringRule) {
      const nextTrigger = this.computeNextRecurrence(row.recurringRule, row.triggerAt);
      if (nextTrigger) {
        const now = new Date();
        const newId = row.id;
        await db.insert(reminders).values({
          id: newId,
          userId: row.userId,
          channelId: row.channelId,
          guildId: row.guildId,
          message: row.message,
          triggerAt: nextTrigger,
          createdAt: row.createdAt,
          status: "pending",
          recurringRule: row.recurringRule,
          snoozeCount: 0,
        });
        this.add({ ...row, triggerAt: nextTrigger, status: "pending", snoozeCount: 0 });
      }
    }
  }

  async handleSnooze(reminderId: string, duration: string, userId: string) {
    const reminder = await db.query.reminders.findFirst({
      where: eq(reminders.id, reminderId),
    });

    if (!reminder || reminder.userId !== userId) return null;

    let newDate: Date;
    const now = new Date();
    switch (duration) {
      case "5m":
        newDate = addMinutes(now, 5);
        break;
      case "15m":
        newDate = addMinutes(now, 15);
        break;
      case "1h":
        newDate = addHours(now, 1);
        break;
      case "1d":
        newDate = addDays(now, 1);
        break;
      default:
        return null;
    }

    await db
      .update(reminders)
      .set({
        status: "pending",
        triggerAt: newDate,
        snoozeCount: reminder.snoozeCount + 1,
      })
      .where(eq(reminders.id, reminderId));

    this.add({
      id: reminder.id,
      userId: reminder.userId,
      channelId: reminder.channelId,
      guildId: reminder.guildId,
      message: reminder.message,
      triggerAt: newDate,
      createdAt: reminder.createdAt,
      recurringRule: reminder.recurringRule,
      snoozeCount: reminder.snoozeCount + 1,
      status: "pending",
    });

    return newDate;
  }

  private computeNextRecurrence(rule: string, from: Date): Date | null {
    const parts = rule.split(" ");
    if (parts.length !== 5) return null;

    const [minute, hour, dayOfMonth, , dayOfWeek] = parts.map(Number);
    const next = new Date(from.getTime() + 60_000);
    next.setSeconds(0, 0);

    if (!isNaN(dayOfWeek)) {
      const currentDay = next.getDay();
      const targetDay = dayOfWeek % 7;
      const daysAhead = (targetDay - currentDay + 7) % 7 || 7;
      next.setDate(next.getDate() + daysAhead);
    }

    if (!isNaN(hour)) next.setHours(hour, 0, 0, 0);
    if (!isNaN(minute)) next.setMinutes(minute, 0, 0);

    return next;
  }
}
