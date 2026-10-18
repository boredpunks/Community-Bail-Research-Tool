import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";

export interface DiscoveryCriteriaData {
  courtOffice: "ANY" | "CP-05-02-Crim" | "CP-05-02-Fam" | "CP-05-02-Juv";
  courtRoom?: string;
  eventType: "Bail Hearing" | "Preliminary Arraignment" | "ANY";
  calendarPreviewOnly?: boolean;
  startDate: string;
  endDate: string;
  recordCap: number;
  requestCap: number;
  // Optional only for jobs created before matching-target collection existed.
  matchTarget?: number;
  matchFilters?: {
    monetaryUpperBoundCents: number | null;
    excludeShownPosted: boolean;
    // Absent on legacy jobs, which retain their original strict comparison.
    inclusiveMaximum?: boolean;
  };
}
export interface DiscoveryEntryData {
  action: string;
  wording: string;
  orderDate: string | null;
  bailCategory: "MONETARY" | "NOMINAL" | "UNSECURED" | "NONMONETARY" | "RECOGNIZANCE" | "DENIED" | "UNKNOWN";
  amountCents: number | null;
  financialBasis: "TOTAL_BAIL" | "UNSECURED_AMOUNT" | null;
  sourcePages?: number[];
}
export interface DiscoveryProvenanceData {
  calendarUrl: string;
  calendarRetrievedAt: string;
  courtOffice: string;
  courtType?: "MDJ" | "COMMON_PLEAS" | "UNSUPPORTED";
  eventType: string;
  courtRoom?: string | null;
  eventDate: string | null;
  filingDate: string | null;
  extractionOutcome: "UNPROCESSED" | "EXTRACTED" | "MISSING_BAIL_SECTION" | "UNREADABLE" | "UNSUPPORTED_LAYOUT" | "IDENTITY_MISMATCH" | "RETRIEVAL_FAILED";
  postedEntryState: "SHOWN_POSTED" | "NOT_SHOWN" | "UNKNOWN";
  entries: DiscoveryEntryData[];
  documentSha256?: string;
  documentPageCount?: number;
  bailSectionPages?: number[];
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
  resultsExpiredAt: timestamp("results_expired_at", { withTimezone: true }),
  resultCounts: jsonb("result_counts").$type<{
    discovered: number; processed: number; matching: number; failed: number; unprocessed: number;
  }>(),
  assessmentId: uuid("assessment_id"),
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
  movedToCandidatesAt: timestamp("moved_to_candidates_at", { withTimezone: true }),
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
  sourceId: text("source_id").notNull().default("UJS"),
  resourceKey: text("resource_key"),
  itemId: uuid("item_id"),
  path: text("path").notNull(),
  method: text("method").notNull(),
  statusCode: integer("status_code"),
  outcome: text("outcome").notNull().default("IN_FLIGHT"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
}, (t) => [
  index("discovery_requests_job").on(t.jobId, t.startedAt),
  index("discovery_requests_source_time").on(t.sourceId, t.startedAt),
  uniqueIndex("discovery_one_in_flight").on(t.sourceId).where(sql`${t.outcome} = 'IN_FLIGHT'`),
]);

export const discoverySourceTable = pgTable("discovery_source_control", {
  id: text("id").primaryKey(),
  lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  pausedUntil: timestamp("paused_until", { withTimezone: true }),
  blockedReason: text("blocked_reason"),
  accessVerifiedAt: timestamp("access_verified_at", { withTimezone: true }),
  verifiedMethod: text("verified_method"),
  collectionApprovedAt: timestamp("collection_approved_at", { withTimezone: true }),
  activeRequestId: uuid("active_request_id"),
  adaptiveSpacingMs: integer("adaptive_spacing_ms").notNull().default(60000),
  slowResponseStreak: integer("slow_response_streak").notNull().default(0),
  throttleCount: integer("throttle_count").notNull().default(0),
  lastLatencyMs: integer("last_latency_ms"),
  latencyWarning: text("latency_warning"),
});

// Prepared protocols are not authorization. Only an operator can approve and
// execute an expiring, single-use permit; there is no public bypass endpoint.
export const discoveryAssessmentsTable = pgTable("discovery_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  stage: text("stage").notNull(),
  state: text("state").notNull().default("PREPARED"),
  criteria: jsonb("criteria").$type<DiscoveryCriteriaData>().notNull(),
  expectedMethod: text("expected_method").notNull(),
  // Operator-granted execution only; NULL keeps a permit CLI-only.
  executionOwnerId: text("execution_owner_id"),
  jobId: uuid("job_id").references(() => discoveryJobsTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  report: jsonb("report").$type<{
    requests: number; validDocuments: number; failures: number; reason: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDiscoveryJobSchema = createInsertSchema(discoveryJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type DiscoveryJobRow = typeof discoveryJobsTable.$inferSelect;
export type DiscoveryItemRow = typeof discoveryItemsTable.$inferSelect;
