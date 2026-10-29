import { boolean, date, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";
import { bailSearchesTable } from "./bail-searches";

export interface BailDecisionEvidence {
  date: string;
  classification: string;
  amount: number | null;
  percentage: number | null;
  page: number | null;
  quote: string;
}
export const bailSearchResultsTable = pgTable("bail_search_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  searchId: uuid("search_id").notNull().references(() => bailSearchesTable.id),
  sourceItemId: uuid("source_item_id"),
  sourceUrl: text("source_url"),
  sourceRetrievedAt: timestamp("source_retrieved_at", { withTimezone: true }),
  savedRecordId: uuid("saved_record_id"),
  docketNumber: text("docket_number").notNull(),
  hearingDate: date("hearing_date", { mode: "string" }).notNull(),
  office: text("office").notNull(),
  decisionDate: date("decision_date", { mode: "string" }),
  classification: text("classification").notNull(),
  amountCents: integer("amount_cents"),
  percentage: text("percentage"),
  evidencePage: integer("evidence_page"),
  evidenceQuote: text("evidence_quote").notNull(),
  evidenceAcquisition: text("evidence_acquisition").notNull(),
  qualifies: boolean("qualifies").notNull().default(false),
  ambiguous: boolean("ambiguous").notNull().default(false),
  history: jsonb("history").$type<BailDecisionEvidence[]>().notNull().default([]),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("bail_search_result_docket_hearing").on(t.searchId, t.docketNumber, t.hearingDate)]);
export const insertBailSearchResultSchema = createInsertSchema(bailSearchResultsTable).omit({ id: true, createdAt: true });
export type BailSearchResultRow = typeof bailSearchResultsTable.$inferSelect;
export type InsertBailSearchResult = z.infer<typeof insertBailSearchResultSchema>;
