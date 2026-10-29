import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, bailSearchesTable, bailSearchResultsTable, discoveryJobsTable, discoverySourceTable, volunteerFeedbackTable } from "@workspace/db";
import { StartBailSearchBody, ResumeBailSearchBody, GetBailSearchStatusParams, SubmitVolunteerFeedbackBody, SaveBailSearchResultBody, SaveBailSearchResultParams, ExportBailSearchQueryParams } from "@workspace/api-zod";
import { hasValidWorkspaceSession, requireResearchAuth, requireSameOrigin, getWorkspaceIdentity, WORKSPACE_COOKIE_NAME } from "../middlewares/researchAuth";
import { calendarSearchReadiness } from "../services/calendar-search";
import { SEARCH_SLICE_MS, exportSearchCsv, savedQueue, searchOwner, searchResponse, searchRecovery, enrichedResult, validResumeToken, validateSearchDates } from "../services/bail-search-store";
import { shareResult } from "../services/bail-search-evidence";
import { easternToday } from "../lib/discovery";
import { calendarAdmission } from "../lib/research-operations";
import { sourceAdmissionBlock, discoverySourceStatus } from "../lib/discovery-source-status";
import { resultsDeadline } from "../lib/discovery-safety";

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
router.get("/feedback", async (_req, res) => {
  const rows = await db.select().from(volunteerFeedbackTable).orderBy(desc(volunteerFeedbackTable.createdAt)).limit(100);
  res.json(rows.map(({ ownerId: _owner, createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString() })));
});
router.post("/feedback", async (req, res) => {
  const input = SubmitVolunteerFeedbackBody.safeParse(req.body);
  if (!input.success || Object.values(input.data).some(value => !value.trim())) {
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
  const rows = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.ownerId, res.locals.searchOwner))
    .orderBy(desc(bailSearchesTable.createdAt)).limit(20);
  res.json(await Promise.all(rows.map(row => searchResponse(row, false))));
});
router.post("/search", async (req, res) => {
  const input = StartBailSearchBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Provide hearing dates, maximum bail, and an explicit source." }); return; }
  if (input.data.source !== "saved") { res.status(409).json({ error: "Live calendar discovery is coming soon. Choose collected workspace evidence." }); return; }
  try {
    validateSearchDates(input.data);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid criteria." }); return; }
  const ownerId: string = res.locals.searchOwner;
  const { ownerIds } = getWorkspaceIdentity(res);
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
  res.status(201).json(await searchResponse(current!));
});
router.use("/search/:searchId", async (req, res, next) => {
  const params = GetBailSearchStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid search ID." }); return; }
  const [search] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, params.data.searchId));
  if (!search) { res.status(404).json({ error: "Search not found." }); return; }
  if (search.ownerId !== res.locals.searchOwner) { res.status(403).json({ error: "This search belongs to a different signed-in session." }); return; }
  res.locals.search = search;
  next();
});
router.get("/search/:searchId/status", async (_req, res) => { res.json(await searchResponse(res.locals.search)); });
router.get("/search/:searchId/export", async (_req, res) => {
  const query = ExportBailSearchQueryParams.safeParse(_req.query);
  if (!query.success) { res.status(400).json({ error: "Choose all records or amount-filter matches." }); return; }
  res.type("text/csv").attachment(`bail-search-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(await exportSearchCsv(res.locals.search, query.data.selection));
});
router.post("/search/:searchId/results/:resultId/save", async (req, res) => {
  const params = SaveBailSearchResultParams.safeParse(req.params);
  const input = SaveBailSearchResultBody.safeParse(req.body);
  if (!params.success || !input.success || input.data.shareWithWorkspace !== true) {
    res.status(400).json({ error: "Confirm that this evidence will be shared with the workspace." }); return;
  }
  const [row] = await db.select().from(bailSearchResultsTable).where(and(
    eq(bailSearchResultsTable.id, params.data.resultId), eq(bailSearchResultsTable.searchId, res.locals.search.id),
  ));
  if (!row) { res.status(404).json({ error: "Result not found in this search." }); return; }
  let recordId: string;
  try { recordId = await shareResult(res.locals.search, row, getWorkspaceIdentity(res).ownerId); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Evidence cannot be saved." }); return; }
  const [updated] = await db.update(bailSearchResultsTable).set({ savedRecordId: recordId })
    .where(eq(bailSearchResultsTable.id, row.id)).returning();
  res.json(await enrichedResult(res.locals.search, updated!));
});
router.post("/search/:searchId/resume", async (req, res) => {
  const input = ResumeBailSearchBody.safeParse(req.body);
  const prior = res.locals.search as typeof bailSearchesTable.$inferSelect;
  if (!input.success || !validResumeToken(prior, input.data.resumeToken)) { res.status(403).json({ error: "Invalid or expired resume token." }); return; }
  const rows = await db.select().from(bailSearchResultsTable).where(eq(bailSearchResultsTable.searchId, prior.id));
  const { recovery } = await searchRecovery(prior, rows.some(row => !!row.error));
  if (recovery.action !== "resume") { res.status(409).json({ error: recovery.message }); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${prior.ownerId}))`);
    const [search] = await tx.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, prior.id)).for("update");
    if (!search || search.status !== "paused" || !validResumeToken(search, input.data.resumeToken)) return "Search is no longer paused.";
    if (search.resumeAvailableAt && search.resumeAvailableAt > new Date()) return "Source cooldown has not expired.";
    const active = await tx.select().from(bailSearchesTable).where(and(eq(bailSearchesTable.ownerId, search.ownerId), eq(bailSearchesTable.status, "running")));
    if (active.length) return "Another search is running.";
    if (search.criteria.source === "live") {
      if (!search.discoveryJobId) return "The source search did not start. Start a new search after the source blocker is resolved.";
      const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, "UJS")).for("update");
      const [job] = await tx.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, search.discoveryJobId)).for("update");
      if (!job || job.status !== "PAUSED" || job.assessmentId || job.resultsExpiredAt
        || (resultsDeadline(job) && resultsDeadline(job)! <= new Date())
        || (!job.calendarComplete && job.criteria.startDate < easternToday())
        || job.requestsUsed >= job.criteria.requestCap) return "Original source scope or budget cannot resume. Start a new eligible search.";
      const block = !job.calendarComplete ? await calendarAdmission(tx, source) : await sourceAdmissionBlock(tx, source);
      if (block) return `Source remains paused: ${block}.`;
      await tx.update(discoveryJobsTable).set({ status: "QUEUED", updatedAt: new Date() }).where(eq(discoveryJobsTable.id, job.id));
    }
    await tx.update(bailSearchesTable).set({ status: "running", reason: null, resumeVersion: search.resumeVersion + 1,
      leaseExpiresAt: new Date(Date.now() + SEARCH_SLICE_MS), resumeAvailableAt: null, updatedAt: new Date() }).where(eq(bailSearchesTable.id, search.id));
    return null;
  });
  if (result) { res.status(409).json({ error: result }); return; }
  const [updated] = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.id, prior.id));
  res.json(await searchResponse(updated!));
});
export default router;
