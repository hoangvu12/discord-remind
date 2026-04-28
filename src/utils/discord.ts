import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, type MessageActionRowComponentBuilder, StringSelectMenuBuilder } from "discord.js";
import { searchTimezones } from "./timezones.js";

export function discordTimestamp(date: Date, style: string = "R"): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function createReminderEmbed(
  message: string,
  triggerAt: Date,
  createdAt: Date,
  id: string,
  timezone: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Reminder")
    .setDescription(message)
    .addFields(
      { name: "When", value: discordTimestamp(triggerAt, "R"), inline: true },
      { name: "Exact time", value: discordTimestamp(triggerAt, "F"), inline: true },
      { name: "Set", value: discordTimestamp(createdAt, "R"), inline: true },
    )
    .setFooter({ text: `ID: ${id} · ${timezone}` });
}

export function createConfirmationEmbed(
  message: string,
  triggerAt: Date,
  timezone: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("Confirm Reminder")
    .setDescription(message)
    .addFields(
      { name: "When", value: discordTimestamp(triggerAt, "R"), inline: true },
      { name: "Exact time", value: discordTimestamp(triggerAt, "F"), inline: true },
      { name: "Timezone", value: timezone, inline: true },
    )
    .setFooter({ text: "Times shown in your local timezone" });
}

export function createSnoozeButtons(reminderId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`snooze:${reminderId}:5m`)
      .setLabel("5m")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`snooze:${reminderId}:15m`)
      .setLabel("15m")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`snooze:${reminderId}:1h`)
      .setLabel("1h")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`snooze:${reminderId}:1d`)
      .setLabel("1d")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`dismiss:${reminderId}`)
      .setLabel("Dismiss")
      .setStyle(ButtonStyle.Danger),
  );
}

export function createConfirmButtons(
  id: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm:${id}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel:${id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );
}

export function createOnboardingEmbed(detectedTimezone: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Welcome!")
    .setDescription("Before we start, let's set up your timezone so reminders fire at the right time.")
    .addFields({
      name: "Detected timezone",
      value: `**${detectedTimezone}** (from your Discord language)`,
      inline: false,
    });
}

export function createOnboardingButtons(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("onboard:confirm")
      .setLabel("Looks right")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("onboard:change")
      .setLabel("Change timezone")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function createTimezoneSelectMenu(customId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const popular = searchTimezones("").slice(0, 25);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Select your timezone...")
      .addOptions(popular.map((tz) => ({ label: tz, value: tz }))),
  );
}

export function createPaginationButtons(page: number, totalPages: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (page > 0) {
    row.addComponents(new ButtonBuilder().setCustomId("page:prev").setLabel("Previous").setStyle(ButtonStyle.Secondary));
  }
  if (page < totalPages - 1) {
    row.addComponents(new ButtonBuilder().setCustomId("page:next").setLabel("Next").setStyle(ButtonStyle.Secondary));
  }
  return row;
}

export function generateParseSuggestions(input: string): string[] {
  const suggestions: string[] = [];
  const lower = input.toLowerCase().trim();

  if (/^\d{1,2}$/.test(lower)) {
    suggestions.push(`${input}:00`, `${input}pm`, `in ${input} minutes`);
  } else if (/^\d{1,2}:\d{2}$/.test(lower)) {
    suggestions.push(`${input} tomorrow`, `${input} today`);
  } else if (/^\d{1,2}(am|pm)$/i.test(lower)) {
    suggestions.push(`${input} today`, `${input} tomorrow`);
  } else if (/tomorrow/i.test(lower)) {
    suggestions.push("tomorrow at 8am", "tomorrow at 3pm", "tomorrow morning");
  } else if (/today/i.test(lower)) {
    suggestions.push("today at 5pm", "today at noon", "today at 8pm");
  } else if (/next/i.test(lower)) {
    suggestions.push("next Monday", "next Friday at 9am", "next week");
  } else if (/in\s+\d/i.test(lower)) {
    suggestions.push("in 30 minutes", "in 2 hours", "in 3 days");
  }

  if (suggestions.length === 0) {
    suggestions.push("8pm today", "tomorrow at 3pm", "in 2 hours", "next Monday at 9am");
  }

  return suggestions.slice(0, 4);
}
