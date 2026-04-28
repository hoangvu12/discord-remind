import {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import type { SlashCommand } from "./index.js";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { reminders } from "../db/schema.js";
import { discordTimestamp, createPaginationButtons } from "../utils/discord.js";
import { paginatedLists } from "./confirmations.js";

const perPage = 5;

export const remindList: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("remind-list")
    .setDescription("View your pending reminders")
    .setIntegrationTypes(
      ApplicationIntegrationType.UserInstall,
      ApplicationIntegrationType.GuildInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction) {
    const list = await db
      .select()
      .from(reminders)
      .where(
        and(eq(reminders.userId, interaction.user.id), eq(reminders.status, "pending")),
      )
      .orderBy(reminders.triggerAt);

    if (list.length === 0) {
      await interaction.reply({ content: "No pending reminders.", flags: MessageFlags.Ephemeral });
      return;
    }

    const totalPages = Math.ceil(list.length / perPage);
    const state = {
      userId: interaction.user.id,
      reminders: list.map((r) => ({ id: r.id, message: r.message, triggerAt: r.triggerAt })),
      page: 0,
    };
    paginatedLists.set(interaction.user.id, state);
    setTimeout(() => paginatedLists.delete(interaction.user.id), 5 * 60_000);

    const embed = buildPageEmbed(state.reminders, 0, totalPages, list.length);
    const row = createPaginationButtons(0, totalPages);

    await interaction.reply({ embeds: [embed], components: row.components.length > 0 ? [row] : [], flags: MessageFlags.Ephemeral });
  },
};

export function buildPageEmbed(
  items: { id: string; message: string; triggerAt: Date }[],
  page: number,
  totalPages: number,
  total: number,
): EmbedBuilder {
  const pageItems = items.slice(page * perPage, (page + 1) * perPage);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Your Reminders")
    .setDescription(
      pageItems
        .map(
          (r) =>
            `**${r.id}** · ${discordTimestamp(r.triggerAt, "R")} · ${discordTimestamp(r.triggerAt, "f")}\n> ${r.message.length > 100 ? r.message.slice(0, 100) + "..." : r.message}`,
        )
        .join("\n\n"),
    )
    .setFooter({ text: `Page ${page + 1}/${totalPages} · ${total} reminder(s)` });
}
