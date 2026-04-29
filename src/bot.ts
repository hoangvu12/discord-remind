import { Client, GatewayIntentBits, Events, MessageFlags } from "discord.js";
import { config } from "./config.js";
import "./db/index.js";
import { getCommandData, handleCommand, handleAutocomplete } from "./commands/index.js";
import { pendingConfirmations, onboardingSessions, paginatedLists } from "./commands/confirmations.js";
import type { ParsedWhen } from "./parser/parse-when.js";
import { ReminderScheduler } from "./scheduler/scheduler.js";
import { db } from "./db/index.js";
import { reminders, userSettings } from "./db/schema.js";
import { discordTimestamp, createOnboardingButtons, createPaginationButtons, createConfirmationEmbed, createConfirmButtons, createTimezoneModal } from "./utils/discord.js";
import { buildPageEmbed } from "./commands/remind-list.js";
import { generateReminderId } from "./utils/id.js";
import { timezoneFromLocale } from "./utils/locale-tz.js";
import { eq } from "drizzle-orm";

const scheduler = new ReminderScheduler();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  try {
    await client.rest.put(
      `/applications/${client.user!.id}/commands`,
      { body: getCommandData() },
    );
    console.log("Registered application commands");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }

  scheduler.setClient(client);
  await scheduler.start();
  console.log("Scheduler started");
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction, scheduler);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (err) {
    console.error("Interaction error:", err);
    try {
      if (interaction.isRepliable() && !interaction.replied) {
        const replyOptions: any = { content: "Something went wrong. Please try again." };
        if (!interaction.isAutocomplete()) replyOptions.flags = MessageFlags.Ephemeral;
        await interaction.reply(replyOptions);
      }
    } catch {}
  }
});

async function handleButton(interaction: any) {
  const customId = interaction.customId;

  if (customId.startsWith("onboard:")) {
    const session = onboardingSessions.get(interaction.user.id);
    if (!session) {
      await interaction.update({ content: "Session expired. Use /remind to try again.", embeds: [], components: [] });
      return;
    }

    if (customId === "onboard:confirm") {
      const tz = session.detectedTimezone;
      await saveUserTimezone(interaction.user.id, tz);
      onboardingSessions.delete(interaction.user.id);

      if (session.pendingReminder) {
        await showReminderConfirmation(interaction, session.pendingReminder, tz);
      } else {
        await interaction.update({
          content: `Timezone set to **${tz}**! Now use \`/remind\` to set a reminder.`,
          embeds: [],
          components: [],
        });
      }
    } else if (customId === "onboard:change") {
      const modal = createTimezoneModal();
      await interaction.showModal(modal);
    }

  } else if (customId.startsWith("confirm:")) {
    const id = customId.slice(8);
    const pending = pendingConfirmations.get(id);

    if (!pending || pending.userId !== interaction.user.id) {
      await interaction.update({
        content: "This confirmation has expired. Use /remind to try again.",
        embeds: [],
        components: [],
      });
      return;
    }

    pendingConfirmations.delete(id);
    const rule = pending.recurringRule ?? null;

    await db.insert(reminders).values({
      id,
      userId: pending.userId,
      channelId: pending.channelId,
      guildId: pending.guildId,
      message: pending.message,
      triggerAt: pending.triggerAt,
      createdAt: pending.createdAt,
      status: "pending",
      recurringRule: rule,
    });

    scheduler.add({
      id,
      userId: pending.userId,
      channelId: pending.channelId,
      guildId: pending.guildId,
      message: pending.message,
      triggerAt: pending.triggerAt,
      createdAt: pending.createdAt,
      recurringRule: rule,
      snoozeCount: 0,
      status: "pending",
    });

    await interaction.update({
      content: `Reminder set! ${discordTimestamp(pending.triggerAt, "R")}`,
      embeds: [],
      components: [],
    });

  } else if (customId.startsWith("cancel:")) {
    pendingConfirmations.delete(customId.slice(7));
    await interaction.update({ content: "Cancelled.", embeds: [], components: [] });

  } else if (customId.startsWith("snooze:")) {
    const [, reminderId, duration] = customId.split(":");
    const newDate = await scheduler.handleSnooze(reminderId, duration, interaction.user.id);
    if (newDate) {
      await interaction.update({
        content: `Snoozed for ${duration} — ${discordTimestamp(newDate, "R")}`,
        embeds: [],
        components: [],
      });
    } else {
      await interaction.update({
        content: "Could not snooze this reminder.",
        embeds: [],
        components: [],
      });
    }

  } else if (customId.startsWith("dismiss:")) {
    const reminderId = customId.slice(8);
    await db.delete(reminders).where(eq(reminders.id, reminderId));
    scheduler.remove(reminderId);
    await interaction.update({ content: "Dismissed.", embeds: [], components: [] });

  } else if (customId === "page:prev" || customId === "page:next") {
    const state = paginatedLists.get(interaction.user.id);
    if (!state) {
      await interaction.update({ content: "List expired. Use /remind-list again.", embeds: [], components: [] });
      return;
    }

    const totalPages = Math.ceil(state.reminders.length / 5);
    if (customId === "page:prev" && state.page > 0) state.page--;
    if (customId === "page:next" && state.page < totalPages - 1) state.page++;

    const embed = buildPageEmbed(state.reminders, state.page, totalPages, state.reminders.length);
    const row = createPaginationButtons(state.page, totalPages);

    await interaction.update({
      embeds: [embed],
      components: row.components.length > 0 ? [row] : [],
    });
  }
}

async function handleModalSubmit(interaction: any) {
  const customId = interaction.customId;

  if (customId === "tzmodal:onboard") {
    const session = onboardingSessions.get(interaction.user.id);
    if (!session) {
      await interaction.update({ content: "Session expired. Use /remind to try again.", embeds: [], components: [] });
      return;
    }

    const tzInput = interaction.fields.getTextInputValue("tzinput");

    try {
      Intl.DateTimeFormat(undefined, { timeZone: tzInput });
    } catch {
      await interaction.reply({
        content: `"${tzInput}" is not a valid IANA timezone. Try something like \`Asia/Ho_Chi_Minh\` or \`US/Eastern\`. Run \`/remind\` again to retry.`,
        flags: MessageFlags.Ephemeral,
      });
      onboardingSessions.delete(interaction.user.id);
      return;
    }

    await saveUserTimezone(interaction.user.id, tzInput);
    onboardingSessions.delete(interaction.user.id);

    if (session.pendingReminder) {
      const reParsed = await import("./parser/parse-when.js").then((m) =>
        m.parseWhen(session.pendingReminder!.whenInput, interaction.user.id, interaction.locale),
      );
      if (reParsed) {
        await showReminderConfirmation(interaction, { ...session.pendingReminder, parsed: reParsed }, tzInput);
        return;
      }
    }

    await interaction.reply({
      content: `Timezone set to **${tzInput}**! Now use \`/remind\` to set a reminder.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function saveUserTimezone(userId: string, timezone: string) {
  const now = new Date();
  await db.insert(userSettings).values({
    userId,
    timezone,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: userSettings.userId,
    set: { timezone, updatedAt: now },
  });
}

async function showReminderConfirmation(
  interaction: any,
  pending: { message: string; parsed: ParsedWhen },
  timezone: string,
) {
  const id = generateReminderId();
  const now = new Date();
  const rule = pending.parsed.recurringRule ?? null;

  pendingConfirmations.set(id, {
    userId: interaction.user.id,
    message: pending.message,
    triggerAt: pending.parsed.date,
    channelId: interaction.channelId ?? null,
    guildId: interaction.guildId ?? null,
    createdAt: now,
    recurringRule: rule,
  });

  setTimeout(() => pendingConfirmations.delete(id), 5 * 60_000);

  const embed = createConfirmationEmbed(pending.message, pending.parsed.date, timezone, rule);
  const row = createConfirmButtons(id);

  const replyData = {
    content: `Timezone set to **${timezone}**! Here's your reminder:`,
    embeds: [embed],
    components: [row],
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(replyData);
  } else {
    await interaction.reply({ ...replyData, flags: MessageFlags.Ephemeral });
  }
}

client.login(config.DISCORD_TOKEN);
