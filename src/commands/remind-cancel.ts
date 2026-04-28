import {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
} from "discord.js";
import type { SlashCommand } from "./index.js";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { reminders } from "../db/schema.js";
import { discordTimestamp } from "../utils/discord.js";

export const remindCancel: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("remind-cancel")
    .setDescription("Cancel a pending reminder")
    .setIntegrationTypes(
      ApplicationIntegrationType.UserInstall,
      ApplicationIntegrationType.GuildInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addStringOption((o) =>
      o
        .setName("id")
        .setDescription("The reminder ID to cancel")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction, scheduler) {
    const id = interaction.options.getString("id", true);

    const reminder = await db.query.reminders.findFirst({
      where: and(eq(reminders.id, id), eq(reminders.userId, interaction.user.id)),
    });

    if (!reminder || reminder.status !== "pending") {
      await interaction.reply({ content: "Reminder not found.", flags: MessageFlags.Ephemeral });
      return;
    }

    await db
      .update(reminders)
      .set({ status: "cancelled" })
      .where(eq(reminders.id, id));

    scheduler.remove(id);

    await interaction.reply({
      content: `Reminder **${id}** cancelled.`,
      flags: MessageFlags.Ephemeral,
    });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "id") return;

    const list = await db
      .select({ id: reminders.id, message: reminders.message, triggerAt: reminders.triggerAt })
      .from(reminders)
      .where(and(eq(reminders.userId, interaction.user.id), eq(reminders.status, "pending")))
      .orderBy(reminders.triggerAt)
      .limit(25);

    await interaction.respond(
      list.map((r) => ({
        name: `${r.id} — ${r.message.slice(0, 40)}`,
        value: r.id,
      })),
    );
  },
};
