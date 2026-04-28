import { nanoid } from "nanoid";

export function generateReminderId(): string {
  return nanoid(8);
}
