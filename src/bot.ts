import { Client, GatewayIntentBits, Events, MessageFlags, StringSelectMenuInteraction } from "discord.js";
import { config } from "./config.js";
import "./db/index.js";
import { getCommandData, handleCommand, handleAutocomplete } from "./commands/index.js";
import { pendingConfirmations, onboardingSessions, paginatedLists } from "./commands/confirmations.js";
import { ReminderScheduler } from "./scheduler/scheduler.js";
import { db } from "./db/index.js";
import { reminders, userSettings } from "./db/schema.js";
import { discordTimestamp, createTimezoneSelectMenu, createOnboardingEmbed, createOnboardingButtons, createPaginationButtons } from "./utils/discord.js";
import { buildPageEmbed } from "./commands/remind-list.js";
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
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
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
      const now = new Date();
      await db.insert(userSettings).values({
        userId: interaction.user.id,
        timezone: session.detectedTimezone,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: userSettings.userId,
        set: { timezone: session.detectedTimezone, updatedAt: now },
      });

      onboardingSessions.delete(interaction.user.id);
      await interaction.update({
        content: `Timezone set to **${session.detectedTimezone}**! Now use \`/remind\` to set your first reminder.`,
        embeds: [],
        components: [],
      });
    } else if (customId === "onboard:change") {
      const row = createTimezoneSelectMenu("tzselect:onboard");
      await interaction.update({
        content: "Pick your timezone:",
        embeds: [],
        components: [row],
      });
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

    await db.insert(reminders).values({
      id,
      userId: pending.userId,
      channelId: pending.channelId,
      guildId: pending.guildId,
      message: pending.message,
      triggerAt: pending.triggerAt,
      createdAt: pending.createdAt,
      status: "pending",
      recurringRule: null,
    });

    scheduler.add({
      id,
      userId: pending.userId,
      channelId: pending.channelId,
      guildId: pending.guildId,
      message: pending.message,
      triggerAt: pending.triggerAt,
      createdAt: pending.createdAt,
      recurringRule: null,
      snoozeCount: 0,
      status: "pending",
    });

    await interaction.update({
      content: `Reminder set! ${discordTimestamp(pending.triggerAt, "R")}`,
      embeds: [],
      components: [],
    });

  } else if (customId.startsWith("cancel:")) {
    const id = customId.slice(7);
    pendingConfirmations.delete(id);

    await interaction.update({
      content: "Cancelled.",
      embeds: [],
      components: [],
    });

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
    await interaction.update({
      content: "Dismissed.",
      embeds: [],
      components: [],
    });

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

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  const customId = interaction.customId;

  if (customId === "tzselect:onboard") {
    const selected = interaction.values[0];
    const now = new Date();

    await db.insert(userSettings).values({
      userId: interaction.user.id,
      timezone: selected,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { timezone: selected, updatedAt: now },
    });

    onboardingSessions.delete(interaction.user.id);
    await interaction.update({
      content: `Timezone set to **${selected}**! Now use \`/remind\` to set your first reminder.`,
      embeds: [],
      components: [],
    });
  }
}

client.login(config.DISCORD_TOKEN);
