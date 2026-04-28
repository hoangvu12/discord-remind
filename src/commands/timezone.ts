import {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import type { SlashCommand } from "./index.js";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";

export const timezone: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("timezone")
    .setDescription("Set or view your timezone")
    .setIntegrationTypes(
      ApplicationIntegrationType.UserInstall,
      ApplicationIntegrationType.GuildInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set your timezone")
        .addStringOption((o) =>
          o
            .setName("timezone")
            .setDescription("IANA timezone (e.g. Asia/Ho_Chi_Minh, US/Eastern)")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("view").setDescription("View your current timezone")),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "view") {
      const settings = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, interaction.user.id),
      });

      await interaction.reply({
        content: `Your timezone: **${settings?.timezone ?? "UTC"}**`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "set") {
      const tzInput = interaction.options.getString("timezone", true);

      try {
        Intl.DateTimeFormat(undefined, { timeZone: tzInput });
      } catch {
        await interaction.reply({
          content: `"${tzInput}" is not a valid timezone. Use IANA format like \`Asia/Ho_Chi_Minh\``,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const now = new Date();
      await db
        .insert(userSettings)
        .values({
          userId: interaction.user.id,
          timezone: tzInput,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { timezone: tzInput, updatedAt: now },
        });

      await interaction.reply({
        content: `Timezone set to **${tzInput}**`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "timezone") return;

    const { searchTimezones } = await import("../utils/timezones.js");
    const matches = searchTimezones(focused.value);

    await interaction.respond(matches.map((tz) => ({ name: tz, value: tz })));
  },
};
