import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, bailSearchesTable, discoveryJobsTable, discoverySourceTable } from "@workspace/db";
import { StartBailSearchBody, ResumeBailSearchBody, GetBailSearchStatusParams } from "@workspace/api-zod";
import { hasValidWorkspaceSession, requireResearchAuth, requireSameOrigin, getWorkspaceIdentity, WORKSPACE_COOKIE_NAME } from "../middlewares/researchAuth";
import { calendarSearchReadiness } from "../services/calendar-search";
import { SEARCH_SLICE_MS, exportSearchCsv, savedQueue, searchOwner, searchResponse, validResumeToken, validateSearchDates } from "../services/bail-search-store";
import { launchDiscovery, newResearchCriteria } from "../lib/discovery-launch";
import { discoveryPolicy, easternToday } from "../lib/discovery";
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
router.get("/readiness", async (_req, res) => { res.json(await calendarSearchReadiness()); });
router.get("/search", async (_req, res) => {
  const rows = await db.select().from(bailSearchesTable).where(eq(bailSearchesTable.ownerId, res.locals.searchOwner))
    .orderBy(desc(bailSearchesTable.createdAt)).limit(20);
  res.json(await Promise.all(rows.map(row => searchResponse(row, false))));
});
router.post("/search", async (req, res) => {
  const input = StartBailSearchBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Provide hearing dates, maximum bail, and an explicit source." }); return; }
  let criteria;
  try {
    validateSearchDates(input.data);
    if (input.data.source === "live") criteria = newResearchCriteria({
      ...input.data, courtOffice: "ANY", eventType: "Bail Hearing", courtRoom: "ANY",
      recordCap: discoveryPolicy.maxRecordCap, requestCap: discoveryPolicy.maxRequestCap,
      matchTarget: discoveryPolicy.maxRecordCap,
      matchFilters: { monetaryUpperBoundCents: Math.round(input.data.maxBail * 100) },
    });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid criteria." }); return; }
  const ownerId: string = res.locals.searchOwner;
  const { ownerIds } = getWorkspaceIdentity(res);
  const queue = input.data.source === "saved" ? await savedQueue(input.data, ownerIds) : [];
  const search = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const [running] = await tx.select().from(bailSearchesTable).where(and(eq(bailSearchesTable.ownerId, ownerId), eq(bailSearchesTable.status, "running")));
    if (running) return null;
    const [created] = await tx.insert(bailSearchesTable).values({
      ownerId, criteria: input.data, queue, total: queue.length,
      status: input.data.source === "saved" ? "running" : "paused",
      leaseExpiresAt: new Date(Date.now() + SEARCH_SLICE_MS),
    }).returning();
    return created!;
  });
  if (!search) { res.status(409).json({ error: "A search is already running in this session." }); return; }
  if (criteria) {
    const result = await launchDiscovery(criteria, ownerId, [...ownerIds, ownerId], async (tx, job) => {
      await tx.update(bailSearchesTable).set({ discoveryJobId: job.id, status: "running", reason: null }).where(eq(bailSearchesTable.id, search.id));
    });
    if (result.error) {
      const source = await discoverySourceStatus();
      await db.update(bailSearchesTable).set({ reason: result.error, resumeAvailableAt: source.nextEligibleAt ? new Date(source.nextEligibleAt) : new Date() }).where(eq(bailSearchesTable.id, search.id));
    }
  }
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
  res.type("text/csv").attachment(`bail-search-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(await exportSearchCsv(res.locals.search));
});
router.post("/search/:searchId/resume", async (req, res) => {
  const input = ResumeBailSearchBody.safeParse(req.body);
  const prior = res.locals.search as typeof bailSearchesTable.$inferSelect;
  if (!input.success || !validResumeToken(prior, input.data.resumeToken)) { res.status(403).json({ error: "Invalid or expired resume token." }); return; }
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
