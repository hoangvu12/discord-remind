import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import type { ReminderScheduler } from "../scheduler/scheduler.js";

export type SlashCommand = {
  data: any;
  execute: (
    interaction: ChatInputCommandInteraction,
    scheduler: ReminderScheduler,
  ) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
};

export const commands = new Map<string, SlashCommand>();

import { remind } from "./remind.js";
import { remindList } from "./remind-list.js";
import { remindCancel } from "./remind-cancel.js";
import { timezone } from "./timezone.js";

for (const cmd of [remind, remindList, remindCancel, timezone]) {
  commands.set(cmd.data.name, cmd);
}

export function getCommandData() {
  return [...commands.values()].map((c) => c.data.toJSON());
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  scheduler: ReminderScheduler,
) {
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  await cmd.execute(interaction, scheduler);
}

export async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const cmd = commands.get(interaction.commandName);
  if (!cmd?.autocomplete) return;
  await cmd.autocomplete(interaction);
}
