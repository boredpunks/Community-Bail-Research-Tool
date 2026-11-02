import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, bailRecordsTable, bailSearchesTable, bailSearchResultsTable, discoveryJobsTable, volunteerFeedbackTable } from "@workspace/db";
import {
  StartBailSearchBody, ResumeBailSearchBody, GetBailSearchStatusParams, SubmitVolunteerFeedbackBody,
  SaveBailSearchResultBody, SaveBailSearchResultParams, ExportBailSearchQueryParams,
  DismissBailSearchReviewResultParams, DismissBailSearchReviewResultResponse,
  ListBailSearchesResponse, StartBailSearchResponse, GetBailSearchStatusResponse, ResumeBailSearchResponse,
  ListBailSearchCandidatesQueryParams, ListBailSearchCandidatesResponse,
  SetBailSearchCandidateOutcomeParams, SetBailSearchCandidateOutcomeBody, SetBailSearchCandidateOutcomeResponse,
  SetBailSearchCandidateArchiveParams, SetBailSearchCandidateArchiveBody, SetBailSearchCandidateArchiveResponse,
  RemoveBailSearchCandidateParams, RemoveBailSearchCandidateResponse,
  ClearOwnedBailSearchesResponse,
} from "@workspace/api-zod";
import { hasValidWorkspaceSession, requireResearchAuth, requireSameOrigin, getWorkspaceIdentity, WORKSPACE_COOKIE_NAME } from "../middlewares/researchAuth";
import { calendarSearchReadiness } from "../services/calendar-search";
import { SEARCH_SLICE_MS, exportSearchCsv, savedQueue, searchOwner, searchResponse, enrichedResult, validateSearchDates } from "../services/bail-search-store";
import { safeDocketLink, shareResult } from "../services/bail-search-evidence";
import { discoveryPolicy } from "../lib/discovery";
import { launchDiscovery, newResearchCriteria } from "../lib/discovery-launch";
import { canManageSearch, withSearchViewerAccess } from "../services/bail-search-access";
import { resumeBailSearch } from "../services/bail-search-resume";

class ActiveVolunteerSearchError extends Error {}

async function searchResponseForViewer(
  search: typeof bailSearchesTable.$inferSelect,
  viewerOwnerId: string,
  includeResults = true,
) {
  const response = await searchResponse(search, includeResults);
  return withSearchViewerAccess(response, search.ownerId, viewerOwnerId);
}

function serializeSearchCandidate(saved: typeof bailRecordsTable.$inferSelect) {
  const entry = saved.discoveryEvidence?.entries.find(value =>
    value.orderDate === saved.orderDate && value.amountCents === saved.amountCents
    && value.bailCategory === saved.bailCategory);
  return {
    id: saved.id,
    docket_number: saved.docketNumber,
    bail_amount: saved.amountCents === null ? null : saved.amountCents / 100,
    source_url: safeDocketLink(saved.sourceUrl, saved.docketNumber),
    evidence_page: entry?.sourcePages?.[0] ?? null,
    bailed_out_at: saved.bailOutReportedAt?.toISOString() ?? null,
    archived_at: saved.candidateArchivedAt?.toISOString() ?? null,
    county: saved.county,
    court_level: saved.courtLevel,
    court_office: saved.discoveryEvidence?.courtOffice ?? null,
    event_date: saved.discoveryEvidence?.eventDate ?? null,
    event_type: saved.discoveryEvidence?.eventType ?? null,
    order_date: saved.orderDate,
    bail_category: saved.bailCategory,
    financial_basis: saved.financialBasis,
    percentage_condition: entry?.percentageCondition ?? null,
    source_title: saved.sourceTitle,
    evidence_quote: entry?.excerpt ?? saved.evidenceNote,
  };
}

const router = Router();
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!hasValidWorkspaceSession(req)) { res.redirect(302, "/?next=%2Fsearch"); return; }
  next();
}, requireResearchAuth, requireSameOrigin);
router.use((req, res, next) => {
  const cookie = req.headers.cookie!.split(";").map(s => s.trim()).find(s => s.startsWith(`${WORKSPACE_COOKIE_NAME}=`))!;
  res.locals.searchOwner = searchOwner(cookie);
  next();
});
router.get("/readiness", async (_req, res) => { res.json(await calendarSearchReadiness(getWorkspaceIdentity(res).ownerIds)); });
router.get("/candidates", async (req, res) => {
  const query = ListBailSearchCandidatesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Choose either the active or archived candidate list." });
    return;
  }
  const archived = query.data.view === "archived";
  const rows = await db.select().from(bailRecordsTable)
    .where(and(inArray(bailRecordsTable.ownerId, getWorkspaceIdentity(res).ownerIds),
      isNotNull(bailRecordsTable.discoveryKey),
      isNull(bailRecordsTable.candidateRemovedAt),
      archived ? isNotNull(bailRecordsTable.candidateArchivedAt) : isNull(bailRecordsTable.candidateArchivedAt)))
    .orderBy(desc(bailRecordsTable.createdAt));
  res.json(ListBailSearchCandidatesResponse.parse(rows.map(serializeSearchCandidate)));
});
router.patch("/candidates/:candidateId/outcome", async (req, res): Promise<void> => {
  const params = SetBailSearchCandidateOutcomeParams.safeParse(req.params);
  const body = SetBailSearchCandidateOutcomeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Candidate ID or outcome is invalid." });
    return;
  }
  const ownerIds = getWorkspaceIdentity(res).ownerIds;
  const conditions = and(
    eq(bailRecordsTable.id, params.data.candidateId),
    inArray(bailRecordsTable.ownerId, ownerIds),
    isNotNull(bailRecordsTable.discoveryKey),
    isNull(bailRecordsTable.candidateRemovedAt),
  );
  const [existing] = await db.select().from(bailRecordsTable).where(conditions);
  if (!existing) {
    res.status(404).json({ error: "Candidate not found in the shared workspace." });
    return;
  }
  if (existing.candidateArchivedAt) {
    res.status(409).json({ error: "Restore this candidate before changing its outcome." });
    return;
  }
  const [updated] = await db.update(bailRecordsTable)
    .set({ bailOutReportedAt: body.data.bailedOut ? existing.bailOutReportedAt ?? new Date() : null })
    .where(conditions)
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Candidate is no longer in the shared list." });
    return;
  }
  res.json(SetBailSearchCandidateOutcomeResponse.parse(serializeSearchCandidate(updated)));
});
router.patch("/candidates/:candidateId/archive", async (req, res): Promise<void> => {
  const params = SetBailSearchCandidateArchiveParams.safeParse(req.params);
  const body = SetBailSearchCandidateArchiveBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Candidate ID or archive state is invalid." });
    return;
  }
  const ownerIds = getWorkspaceIdentity(res).ownerIds;
  const conditions = and(
    eq(bailRecordsTable.id, params.data.candidateId),
    inArray(bailRecordsTable.ownerId, ownerIds),
    isNotNull(bailRecordsTable.discoveryKey),
    isNull(bailRecordsTable.candidateRemovedAt),
  );
  const [existing] = await db.select().from(bailRecordsTable).where(conditions);
  if (!existing) {
    res.status(404).json({ error: "Candidate not found in the shared workspace." });
    return;
  }
  if (body.data.archived && !existing.bailOutReportedAt) {
    res.status(409).json({ error: "Mark the reported successful outcome before archiving this candidate." });
    return;
  }
  const [updated] = await db.update(bailRecordsTable)
    .set({ candidateArchivedAt: body.data.archived ? existing.candidateArchivedAt ?? new Date() : null })
    .where(conditions)
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Candidate is no longer in the shared list." });
    return;
  }
  res.json(SetBailSearchCandidateArchiveResponse.parse(serializeSearchCandidate(updated)));
});
router.delete("/candidates/:candidateId", async (req, res): Promise<void> => {
  const params = RemoveBailSearchCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Candidate ID is invalid." });
    return;
  }
  const ownerIds = getWorkspaceIdentity(res).ownerIds;
  const removed = await db.transaction(async tx => {
    const [candidate] = await tx.select().from(bailRecordsTable).where(and(
      eq(bailRecordsTable.id, params.data.candidateId),
      inArray(bailRecordsTable.ownerId, ownerIds),
      isNotNull(bailRecordsTable.discoveryKey),
      isNull(bailRecordsTable.candidateRemovedAt),
    )).for("update");
    if (!candidate) return false;
    await tx.update(bailRecordsTable)
      .set({ candidateRemovedAt: new Date() })
      .where(eq(bailRecordsTable.id, candidate.id));
    await tx.update(bailSearchResultsTable)
      .set({ savedRecordId: null })
      .where(eq(bailSearchResultsTable.savedRecordId, candidate.id));
    return true;
  });
  if (!removed) {
    res.status(404).json({ error: "Candidate not found in the shared workspace." });
    return;
  }
  res.json(RemoveBailSearchCandidateResponse.parse({ removed: true }));
});
router.get("/feedback", async (_req, res) => {
  const rows = await db.select().from(volunteerFeedbackTable).orderBy(desc(volunteerFeedbackTable.createdAt)).limit(100);
  res.json(rows.map(({ ownerId: _owner, createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString() })));
});
router.post("/feedback", async (req, res) => {
  const input = SubmitVolunteerFeedbackBody.safeParse(req.body);
  if (!input.success || Object.values(input.data).some(value => typeof value !== "string" || !value.trim())) {
    res.status(400).json({ error: "Answer each feedback question using 1–2,000 characters. Do not include personal case details." }); return;
  }
  const ownerId: string = res.locals.searchOwner;
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const [recent] = await tx.select().from(volunteerFeedbackTable).where(and(eq(volunteerFeedbackTable.ownerId, ownerId),
      sql`${volunteerFeedbackTable.createdAt} > now() - interval '15 seconds'`)).limit(1);
    if (recent) return null;
    const [row] = await tx.insert(volunteerFeedbackTable).values({ ownerId, tryingToDo: input.data.tryingToDo.trim(),
      obstacle: input.data.obstacle.trim(), needed: input.data.needed.trim() }).returning();
    return row!;
  });
  if (!result) { res.status(429).setHeader("Retry-After", "15").json({ error: "Your feedback was recently saved. Please wait 15 seconds before submitting again." }); return; }
  const { ownerId: _owner, createdAt, ...row } = result;
  res.status(201).json({ ...row, createdAt: createdAt.toISOString() });
});
router.get("/search", async (_req, res) => {
  const rows = await db.select().from(bailSearchesTable)
    .orderBy(desc(bailSearchesTable.createdAt)).limit(20);
  const searches = await Promise.all(rows.map(row => searchResponseForViewer(row, res.locals.searchOwner, false)));
  res.json(ListBailSearchesResponse.parse(searches));
});
router.delete("/search", async (_req, res): Promise<void> => {
  const ownerId: string = res.locals.searchOwner;
  const cleared = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const owned = await tx.select({ id: bailSearchesTable.id, status: bailSearchesTable.status })
      .from(bailSearchesTable)
      .where(eq(bailSearchesTable.ownerId, ownerId))
      .for("update");
    const removable = owned.filter(search => search.status !== "running");
    const retainedRunning = owned.length - removable.length;
    if (!removable.length) {
      return { deletedSearches: 0, deletedResults: 0, retainedRunning };
    }
    const ids = removable.map(search => search.id);
    const deletedResults = await tx.delete(bailSearchResultsTable)
      .where(inArray(bailSearchResultsTable.searchId, ids))
      .returning({ id: bailSearchResultsTable.id });
    const deletedSearches = await tx.delete(bailSearchesTable)
      .where(and(inArray(bailSearchesTable.id, ids), eq(bailSearchesTable.ownerId, ownerId)))
      .returning({ id: bailSearchesTable.id });
    return {
      deletedSearches: deletedSearches.length,
      deletedResults: deletedResults.length,
      retainedRunning,
    };
  });
  res.json(ClearOwnedBailSearchesResponse.parse(cleared));
});
router.post("/search", async (req, res) => {
  const input = StartBailSearchBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Provide hearing dates, maximum bail, and an explicit source." }); return; }
  try {
    validateSearchDates(input.data);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid criteria." }); return; }
  const ownerId: string = res.locals.searchOwner;
  const { ownerIds } = getWorkspaceIdentity(res);
  if (input.data.source === "live") {
    const recordCap = discoveryPolicy.maxRecordCap;
    let searchId: string | null = null;
    let launched;
    try {
      const criteria = newResearchCriteria({
        startDate: input.data.startDate,
        endDate: input.data.endDate,
        courtOffice: input.data.courtOffice ?? "ANY",
        courtRoom: "ANY",
        eventType: input.data.eventType ?? "Bail Hearing",
        recordCap,
        requestCap: discoveryPolicy.maxRequestCap,
        matchTarget: recordCap,
        matchFilters: {
          monetaryUpperBoundCents: Math.round(input.data.maxBail * 100),
          excludeShownPosted: false,
          inclusiveMaximum: true,
        },
      });
      launched = await launchDiscovery(criteria, getWorkspaceIdentity(res).ownerId, ownerIds, async (tx, job) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
        const [running] = await tx.select().from(bailSearchesTable).where(and(
          eq(bailSearchesTable.ownerId, ownerId), eq(bailSearchesTable.status, "running"),
        ));
        if (running) throw new ActiveVolunteerSearchError("A search is already running in this session.");
        const [created] = await tx.insert(bailSearchesTable).values({
          ownerId,
          discoveryJobId: job.id,
          criteria: input.data,
          queue: [],
          total: 0,
          status: "running",
          leaseExpiresAt: new Date(Date.now() + SEARCH_SLICE_MS),
        }).returning();
        searchId = created!.id;
      }, async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
        const previous = await tx.select().from(bailSearchesTable).where(and(
          eq(bailSearchesTable.ownerId, ownerId), eq(bailSearchesTable.status, "running"),
        ));
        for (const prior of previous) {
          if (prior.discoveryJobId) await tx.update(discoveryJobsTable)
            .set({ status: "PAUSED", message: "Replaced by a new search.", updatedAt: new Date() })
            .where(and(eq(discoveryJobsTable.id, prior.discoveryJobId), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
          await tx.update(bailSearchesTable).set({
            status: "paused", reason: "Replaced by a new search.", resumeVersion: prior.resumeVersion + 1, updatedAt: new Date(),
          }).where(eq(bailSearchesTable.id, prior.id));
        }
      });
    } catch (error) {
      if (error instanceof ActiveVolunteerSearchError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && /today or future|seven days|calendar criteria/i.test(error.message)) {
        res.status(400).json({ error: "Live calendar searches accept today or future dates across at most seven days, with a supported event and office." });
        return;
      }
      throw error;
    }
    if (!launched.payload) {
      res.status(launched.status ?? 409).json({ error: launched.error ?? "The calendar search could not be started." });
      return;
    }
    if (!searchId) {
      res.status(409).json({ error: "The calendar search is already active. Select its existing results or try again after it stops." });
      return;
    }
    const [current] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, searchId));
    res.status(201).json(StartBailSearchResponse.parse(await searchResponseForViewer(current!, ownerId)));
    return;
  }
  let queue;
  try { queue = await savedQueue(input.data, ownerIds); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Choose a narrower hearing-date range." }); return; }
  const search = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const [running] = await tx.select().from(bailSearchesTable).where(and(eq(bailSearchesTable.ownerId, ownerId), eq(bailSearchesTable.status, "running")));
    if (running) return null;
    const [created] = await tx.insert(bailSearchesTable).values({
      ownerId, criteria: input.data, queue, total: queue.length,
      status: "running",
      leaseExpiresAt: new Date(Date.now() + SEARCH_SLICE_MS),
    }).returning();
    return created!;
  });
  if (!search) { res.status(409).json({ error: "A search is already running in this session." }); return; }
  const [current] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, search.id));
  res.status(201).json(StartBailSearchResponse.parse(await searchResponseForViewer(current!, ownerId)));
});
router.use("/search/:searchId", async (req, res, next) => {
  const params = GetBailSearchStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid search ID." }); return; }
  const [search] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, params.data.searchId));
  if (!search) { res.status(404).json({ error: "Search not found." }); return; }
  res.locals.canManageSearch = canManageSearch(search.ownerId, res.locals.searchOwner);
  res.locals.search = search;
  next();
});
router.get("/search/:searchId/status", async (_req, res) => {
  res.json(GetBailSearchStatusResponse.parse(await searchResponseForViewer(res.locals.search, res.locals.searchOwner)));
});
router.get("/search/:searchId/export", async (_req, res) => {
  const query = ExportBailSearchQueryParams.safeParse(_req.query);
  if (!query.success) { res.status(400).json({ error: "Choose all records, amount-filter matches, or visible records." }); return; }
  if (query.data.selection === "visible" && query.data.officeMode === "exact" && query.data.office === undefined) {
    res.status(400).json({ error: "Choose an office to export the visible office-filtered records." }); return;
  }
  res.type("text/csv").attachment(`bail-search-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(await exportSearchCsv(res.locals.search, query.data.selection, query.data.office, query.data.officeMode));
});
router.post("/search/:searchId/results/:resultId/save", async (req, res) => {
  if (!res.locals.canManageSearch) {
    res.status(403).json({ error: "Only the session that created this search can save its results." });
    return;
  }
  const params = SaveBailSearchResultParams.safeParse(req.params);
  const input = SaveBailSearchResultBody.safeParse(req.body);
  if (!params.success || !input.success || input.data.shareWithWorkspace !== true) {
    res.status(400).json({ error: "Confirm that this evidence will be shared with the workspace." }); return;
  }
  const [row] = await db.select().from(bailSearchResultsTable).where(and(
    eq(bailSearchResultsTable.id, params.data.resultId), eq(bailSearchResultsTable.searchId, res.locals.search.id),
  ));
  if (!row) { res.status(404).json({ error: "Result not found in this search." }); return; }
  if (!row.qualifies || row.ambiguous) {
    res.status(409).json({ error: "Only matching, unambiguous results can be marked as candidates." }); return;
  }
  let recordId: string;
  try { recordId = await shareResult(res.locals.search, row, getWorkspaceIdentity(res).ownerId); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Evidence cannot be saved." }); return; }
  const [updated] = await db.update(bailSearchResultsTable).set({ savedRecordId: recordId })
    .where(eq(bailSearchResultsTable.id, row.id)).returning();
  res.json(await enrichedResult(res.locals.search, updated!));
});
router.delete("/search/:searchId/results/:resultId/review", async (req, res): Promise<void> => {
  if (!res.locals.canManageSearch) {
    res.status(403).json({ error: "Only the session that created this search can remove its results from Review." });
    return;
  }
  const params = DismissBailSearchReviewResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Search or result ID is invalid." });
    return;
  }
  const [result] = await db.select().from(bailSearchResultsTable).where(and(
    eq(bailSearchResultsTable.id, params.data.resultId),
    eq(bailSearchResultsTable.searchId, res.locals.search.id),
  ));
  if (!result) {
    res.status(404).json({ error: "Result not found in this search." });
    return;
  }
  if (!result.reviewDismissedAt) {
    await db.update(bailSearchResultsTable)
      .set({ reviewDismissedAt: new Date() })
      .where(and(
        eq(bailSearchResultsTable.id, result.id),
        eq(bailSearchResultsTable.searchId, res.locals.search.id),
      ));
  }
  res.json(DismissBailSearchReviewResultResponse.parse({ dismissed: true }));
});
router.post("/search/:searchId/resume", async (req, res) => {
  if (!res.locals.canManageSearch) {
    res.status(403).json({ error: "Only the session that created this search can resume it." });
    return;
  }
  const input = ResumeBailSearchBody.safeParse(req.body);
  const prior = res.locals.search as typeof bailSearchesTable.$inferSelect;
  if (!input.success) { res.status(403).json({ error: "Invalid or expired resume token." }); return; }
  const result = await resumeBailSearch(prior.id, { resumeToken: input.data.resumeToken });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const [updated] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, prior.id));
  res.json(ResumeBailSearchResponse.parse(await searchResponseForViewer(updated!, prior.ownerId)));
});
export default router;
