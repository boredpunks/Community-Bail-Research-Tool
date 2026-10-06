import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bailRecordsTable, orderInterpretationEnum, reviewStatusEnum } from "./bail-records";

export const bailReviewsTable = pgTable("bail_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordId: uuid("record_id").notNull().references(() => bailRecordsTable.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  decision: reviewStatusEnum("decision").notNull(),
  orderInterpretation: orderInterpretationEnum("order_interpretation").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBailReviewSchema = createInsertSchema(bailReviewsTable).omit({ id: true, createdAt: true });
export type InsertBailReview = z.infer<typeof insertBailReviewSchema>;
export type BailReviewRow = typeof bailReviewsTable.$inferSelect;
