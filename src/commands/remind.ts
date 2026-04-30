import {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { SlashCommand } from "./index.js";
import { parseWhen } from "../parser/parse-when.js";
import { generateReminderId } from "../utils/id.js";
import {
  createConfirmationEmbed,
  createConfirmButtons,
  createOnboardingEmbed,
  createOnboardingButtons,
  generateParseSuggestions,
} from "../utils/discord.js";
import { pendingConfirmations, onboardingSessions, ambiguousResolutions } from "./confirmations.js";
import { timezoneFromLocale } from "../utils/locale-tz.js";
import { fromZonedTime } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";

export const remind: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Set a reminder")
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
      o.setName("when").setDescription("When to remind (e.g. 'tomorrow at 8pm', 'in 2 hours', 'every day at 7am')").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((o) =>
      o.setName("message").setDescription("What to remind you about").setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const whenInput = interaction.options.getString("when", true);
    const message = interaction.options.getString("message", true);

    const settings = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, interaction.user.id),
    });

    const parsed = await parseWhen(whenInput, interaction.user.id, interaction.locale);

    if (!parsed) {
      const suggestions = generateParseSuggestions(whenInput);
      await interaction.editReply({
        content: [
          `Couldn't understand **"${whenInput}"**`,
          "",
          "Try one of these:",
          ...suggestions.map((s) => `- \`${s}\``),
        ].join("\n"),
      });
      return;
    }

    if (parsed.ambiguous) {
      const amb = parsed.ambiguous;
      const ambId = generateReminderId();
      const ts1 = `<t:${Math.floor(fromZonedTime(amb.ddmmyyyy, parsed.timezone).getTime() / 1000)}:F>`;
      const ts2 = `<t:${Math.floor(fromZonedTime(amb.mmddyyyy, parsed.timezone).getTime() / 1000)}:F>`;

      ambiguousResolutions.set(ambId, {
        userId: interaction.user.id,
        message,
        whenInput: whenInput,
        timezone: parsed.timezone,
        ddmmyyyy: amb.ddmmyyyy,
        mmddyyyy: amb.mmddyyyy,
      });
      setTimeout(() => ambiguousResolutions.delete(ambId), 5 * 60_000);

      const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ambresolve:ddmm:${ambId}`)
          .setLabel("DD/MM")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`ambresolve:mmdd:${ambId}`)
          .setLabel("MM/DD")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("ambresolve:cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger),
      );
      await interaction.editReply({
        content: [
          `**"${amb.original}"** could mean two dates:`,
          "",
          `1. **DD/MM** → ${ts1}`,
          `2. **MM/DD** → ${ts2}`,
          "",
          "Which one did you mean?",
        ].join("\n"),
        components: [row],
      });
      return;
    }

    if (parsed.dateRange && parsed.dateRange.length > 1) {
      const dates = parsed.dateRange;
      const maxDisplay = 7;
      const dateList = dates
        .slice(0, maxDisplay)
        .map((d) => `- <t:${Math.floor(d.getTime() / 1000)}:F>`)
        .join("\n");
      const overflow = dates.length > maxDisplay
        ? `\n...and ${dates.length - maxDisplay} more`
        : "";

      const id = generateReminderId();
      const now = new Date();

      pendingConfirmations.set(id, {
        userId: interaction.user.id,
        message,
        triggerAt: parsed.date,
        channelId: interaction.channelId ?? null,
        guildId: interaction.guildId ?? null,
        createdAt: now,
        recurringRule: null,
        dateRange: dates,
      });

      setTimeout(() => pendingConfirmations.delete(id), 5 * 60_000);

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(`Confirm Date Range Reminder (${dates.length} reminders)`)
        .setDescription(message)
        .addFields(
          { name: "Dates", value: `${dateList}${overflow}`, inline: false },
          { name: "Timezone", value: parsed.timezone, inline: true },
        )
        .setFooter({ text: "Times shown in your local timezone" });

      const row = createConfirmButtons(id);
      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    if (!settings) {
      const detected = timezoneFromLocale(interaction.locale);
      onboardingSessions.set(interaction.user.id, {
        userId: interaction.user.id,
        detectedTimezone: detected,
        pendingReminder: {
          whenInput,
          message,
          parsed,
        },
      });

      const embed = createOnboardingEmbed(detected);
      const row = createOnboardingButtons();

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    const id = generateReminderId();
    const now = new Date();
    const rule = parsed.recurringRule ?? null;

    pendingConfirmations.set(id, {
      userId: interaction.user.id,
      message,
      triggerAt: parsed.date,
      channelId: interaction.channelId ?? null,
      guildId: interaction.guildId ?? null,
      createdAt: now,
      recurringRule: rule,
    });

    setTimeout(() => pendingConfirmations.delete(id), 5 * 60_000);

    const embed = createConfirmationEmbed(message, parsed.date, parsed.timezone, rule);
    if (parsed.autoDetected) {
      embed.addFields({
        name: "Timezone auto-detected",
        value: `From your Discord language. Change with \`/timezone set\``,
        inline: false,
      });
    }
    const row = createConfirmButtons(id);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "when") return;

    const value = focused.value;
    if (!value) {
      await interaction.respond([
        { name: "in 30 minutes", value: "in 30 minutes" },
        { name: "in 1 hour", value: "in 1 hour" },
        { name: "in 2 hours", value: "in 2 hours" },
        { name: "tonight at 8pm", value: "tonight at 8pm" },
        { name: "tomorrow at 9am", value: "tomorrow at 9am" },
        { name: "next Monday", value: "next Monday" },
        { name: "every day at 7am", value: "every day at 7am" },
        { name: "every Monday at 9am", value: "every Monday at 9am" },
        { name: "every Monday to Friday at 9am", value: "every Monday to Friday at 9am" },
        { name: "02/05 to 04/05 at 11am", value: "02/05 to 04/05 at 11am" },
      ]);
      return;
    }

    const parsed = await parseWhen(value, interaction.user.id, interaction.locale);
    if (parsed) {
      const ts = discordTimestamp(parsed.date, "R");
      await interaction.respond([
        { name: `${value} → ${ts}`.slice(0, 100), value },
      ]);
    } else {
      await interaction.respond([]);
    }
  },
};

function discordTimestamp(date: Date, style: string = "R"): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}
