import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { DiscoveryProvenanceData } from "./discovery";

export const courtLevelEnum = pgEnum("bail_court_level", ["MDJ", "COMMON_PLEAS"]);
export const bailCategoryEnum = pgEnum("bail_category", ["MONETARY", "NOMINAL", "UNSECURED", "NONMONETARY", "RECOGNIZANCE", "DENIED", "UNKNOWN"]);
export const financialBasisEnum = pgEnum("bail_financial_basis", ["TOTAL_BAIL", "CASH_DEPOSIT", "SURETY_BOND", "UNSECURED_AMOUNT"]);
export const reviewStatusEnum = pgEnum("bail_review_status", ["PENDING", "CONFIRMED", "REJECTED"]);
export const orderInterpretationEnum = pgEnum("bail_order_interpretation", ["UNREVIEWED", "REVIEWED_OPERATIVE", "SUPERSEDED", "UNRESOLVED"]);

export const bailRecordsTable = pgTable("bail_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  caseKey: text("case_key").notNull(),
  docketNumber: text("docket_number").notNull(),
  county: text("county").notNull(),
  courtLevel: courtLevelEnum("court_level").notNull(),
  chargeGroup: text("charge_group"),
  bailCategory: bailCategoryEnum("bail_category").notNull(),
  financialBasis: financialBasisEnum("financial_basis"),
  amountCents: integer("amount_cents"),
  orderDate: date("order_date", { mode: "string" }),
  sourceTitle: text("source_title").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceRetrievedAt: timestamp("source_retrieved_at", { withTimezone: true }).notNull(),
  sourceObservedAt: timestamp("source_observed_at", { withTimezone: true }),
  evidenceNote: text("evidence_note").notNull(),
  discoveryEvidence: jsonb("discovery_evidence").$type<DiscoveryProvenanceData>(),
  discoveryKey: text("discovery_key"),
  discoveryItemId: uuid("discovery_item_id"),
  reviewStatus: reviewStatusEnum("review_status").notNull().default("PENDING"),
  orderInterpretation: orderInterpretationEnum("order_interpretation").notNull().default("UNREVIEWED"),
  reviewComment: text("review_comment"),
  reviewerId: text("reviewer_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("bail_amount_nonnegative", sql`${table.amountCents} IS NULL OR ${table.amountCents} >= 0`),
  check("bail_amount_has_basis", sql`${table.amountCents} IS NULL OR ${table.financialBasis} IS NOT NULL`),
  check("bail_nonmonetary_has_no_amount", sql`${table.bailCategory} NOT IN ('NONMONETARY', 'RECOGNIZANCE', 'DENIED', 'UNKNOWN') OR (${table.amountCents} IS NULL AND ${table.financialBasis} IS NULL)`),
  index("bail_records_owner_created").on(table.ownerId, table.createdAt),
  uniqueIndex("bail_discovery_evidence_dedup").on(table.ownerId, table.discoveryKey),
  uniqueIndex("bail_one_operative_observation_per_docket")
    .on(table.ownerId, table.caseKey)
    .where(sql`${table.reviewStatus} = 'CONFIRMED' AND ${table.orderInterpretation} = 'REVIEWED_OPERATIVE'`),
]);

export const insertBailRecordSchema = createInsertSchema(bailRecordsTable).omit({
  id: true,
  createdAt: true,
  reviewStatus: true,
  orderInterpretation: true,
  reviewComment: true,
  reviewerId: true,
  reviewedAt: true,
});
export type InsertBailRecord = z.infer<typeof insertBailRecordSchema>;
export type BailRecordRow = typeof bailRecordsTable.$inferSelect;
