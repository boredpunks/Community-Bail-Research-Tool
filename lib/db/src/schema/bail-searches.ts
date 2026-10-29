import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

export interface BailSearchCriteria {
  startDate: string;
  endDate: string;
  maxBail: number;
  source: "saved" | "live";
}
export interface BailSearchQueueItem {
  itemId: string;
  docketNumber: string;
  hearingDate: string;
  office: string;
}
export const bailSearchesTable = pgTable("bail_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  discoveryJobId: uuid("discovery_job_id"),
  criteria: jsonb("criteria").$type<BailSearchCriteria>().notNull(),
  status: text("status").notNull().default("paused"),
  queue: jsonb("queue").$type<BailSearchQueueItem[]>().notNull().default([]),
  processed: integer("processed").notNull().default(0),
  total: integer("total").notNull().default(0),
  reason: text("reason"),
  resumeVersion: integer("resume_version").notNull().default(0),
  resumeAvailableAt: timestamp("resume_available_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("bail_search_owner_created").on(t.ownerId, t.createdAt)]);
export const insertBailSearchSchema = createInsertSchema(bailSearchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type BailSearchRow = typeof bailSearchesTable.$inferSelect;
export type InsertBailSearch = z.infer<typeof insertBailSearchSchema>;
