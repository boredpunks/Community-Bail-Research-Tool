import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export interface DiscoveryCriteriaData {
  courtOffice: "CP-05-02-Crim";
  eventType: "Bail Hearing";
  startDate: string;
  endDate: string;
  recordCap: number;
  requestCap: number;
  // Optional only for jobs created before matching-target collection existed.
  matchTarget?: number;
  matchFilters?: {
    monetaryUpperBoundCents: number | null;
    excludeShownPosted: boolean;
  };
}
export interface DiscoveryEntryData {
  action: string;
  wording: string;
  orderDate: string | null;
  bailCategory: "MONETARY" | "NOMINAL" | "UNSECURED" | "NONMONETARY" | "RECOGNIZANCE" | "DENIED" | "UNKNOWN";
  amountCents: number | null;
  financialBasis: "TOTAL_BAIL" | "UNSECURED_AMOUNT" | null;
}
export interface DiscoveryProvenanceData {
  calendarUrl: string;
  calendarRetrievedAt: string;
  courtOffice: string;
  eventType: string;
  eventDate: string | null;
  filingDate: string | null;
  extractionOutcome: "UNPROCESSED" | "EXTRACTED" | "MISSING_BAIL_SECTION" | "UNREADABLE" | "UNSUPPORTED_LAYOUT" | "IDENTITY_MISMATCH" | "RETRIEVAL_FAILED";
  postedEntryState: "SHOWN_POSTED" | "NOT_SHOWN" | "UNKNOWN";
  entries: DiscoveryEntryData[];
}

export const discoveryJobsTable = pgTable("discovery_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  criteria: jsonb("criteria").$type<DiscoveryCriteriaData>().notNull(),
  status: text("status").notNull().default("QUEUED"),
  requestsUsed: integer("requests_used").notNull().default(0),
  calendarComplete: boolean("calendar_complete").notNull().default(false),
  paginationComplete: boolean("pagination_complete").notNull().default(false),
  resultCapReached: boolean("result_cap_reached").notNull().default(false),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("discovery_owner_created").on(t.ownerId, t.createdAt)]);

export const discoveryItemsTable = pgTable("discovery_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => discoveryJobsTable.id),
  ownerId: text("owner_id").notNull(),
  docketNumber: text("docket_number").notNull(),
  position: integer("position").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceRetrievedAt: timestamp("source_retrieved_at", { withTimezone: true }),
  excerpt: text("excerpt"),
  detail: text("detail"),
  provenance: jsonb("provenance").$type<DiscoveryProvenanceData>().notNull(),
}, (t) => [uniqueIndex("discovery_job_docket").on(t.jobId, t.docketNumber), index("discovery_items_owner_job").on(t.ownerId, t.jobId)]);

export const discoveryEventsTable = pgTable("discovery_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => discoveryJobsTable.id),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("discovery_events_job").on(t.jobId, t.createdAt)]);

export const discoveryRequestsTable = pgTable("discovery_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => discoveryJobsTable.id),
  ownerId: text("owner_id").notNull(),
  path: text("path").notNull(),
  method: text("method").notNull(),
  statusCode: integer("status_code"),
  outcome: text("outcome").notNull().default("IN_FLIGHT"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("discovery_requests_job").on(t.jobId, t.startedAt)]);

export const discoverySourceTable = pgTable("discovery_source_control", {
  id: text("id").primaryKey(),
  lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  pausedUntil: timestamp("paused_until", { withTimezone: true }),
  blockedReason: text("blocked_reason"),
});

export const insertDiscoveryJobSchema = createInsertSchema(discoveryJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type DiscoveryJobRow = typeof discoveryJobsTable.$inferSelect;
export type DiscoveryItemRow = typeof discoveryItemsTable.$inferSelect;
