import { z } from "zod/v4";
import "dotenv/config";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().default("./data/reminders.db"),
  DEFAULT_TIMEZONE: z.string().default("UTC"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
