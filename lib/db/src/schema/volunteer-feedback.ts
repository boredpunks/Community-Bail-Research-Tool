import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const volunteerFeedbackTable = pgTable("volunteer_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  tryingToDo: text("trying_to_do").notNull(),
  obstacle: text("obstacle").notNull(),
  needed: text("needed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertVolunteerFeedbackSchema = createInsertSchema(volunteerFeedbackTable).omit({ id: true, createdAt: true });
export type VolunteerFeedbackRow = typeof volunteerFeedbackTable.$inferSelect;
