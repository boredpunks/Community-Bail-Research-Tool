import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { bailRecordsTable, bailReviewsTable, db } from "@workspace/db";
import {
  CreateBailRecordBody,
  CreateBailRecordResponse,
  GetBailRangeQueryParams,
  GetBailRangeResponse,
  ListBailRecordsQueryParams,
  ListBailRecordsResponse,
  ReviewBailRecordBody,
  ReviewBailRecordParams,
  ReviewBailRecordResponse,
} from "@workspace/api-zod";
import { descriptiveRange, escapeLike, serializeBailRecord } from "../lib/bail-records";
import { getWorkspaceIdentity, requireResearchAuth, requireSameOrigin } from "../middlewares/researchAuth";

const router: IRouter = Router();
router.use(requireResearchAuth, requireSameOrigin);

function cohortConditions(ownerIds: string[], filters: { county?: string; courtLevel?: "MDJ" | "COMMON_PLEAS"; chargeGroup?: string }): SQL[] {
  const conditions = [inArray(bailRecordsTable.ownerId, ownerIds)];
  if (filters.county?.trim()) {
    conditions.push(sql`lower(${bailRecordsTable.county}) = ${filters.county.trim().toLowerCase()}`);
  }
  if (filters.courtLevel) conditions.push(eq(bailRecordsTable.courtLevel, filters.courtLevel));
  if (filters.chargeGroup?.trim()) {
    conditions.push(sql`lower(${bailRecordsTable.chargeGroup}) = ${filters.chargeGroup.trim().toLowerCase()}`);
  }
  return conditions;
}

router.get("/records", async (req, res): Promise<void> => {
  const parsed = ListBailRecordsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the search filters and try again." });
    return;
  }
  const { ownerIds } = getWorkspaceIdentity(res);
  const conditions = cohortConditions(ownerIds, parsed.data);
  if (parsed.data.reviewStatus) conditions.push(eq(bailRecordsTable.reviewStatus, parsed.data.reviewStatus));
  if (parsed.data.query?.trim()) {
    const pattern = `%${escapeLike(parsed.data.query.trim())}%`;
    conditions.push(or(ilike(bailRecordsTable.docketNumber, pattern), ilike(bailRecordsTable.chargeGroup, pattern))!);
  }
  const records = await db.select().from(bailRecordsTable).where(and(...conditions)).orderBy(desc(bailRecordsTable.createdAt), bailRecordsTable.id);
  const payload = { records: records.map(serializeBailRecord), total: records.length };
  ListBailRecordsResponse.parse(payload);
  res.json(payload);
});

router.post("/records", async (req, res): Promise<void> => {
  const parsed = CreateBailRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the required fields, monetary amount, source URL, and dates." });
    return;
  }
  const input = parsed.data;
  const { ownerId } = getWorkspaceIdentity(res);
  if (!input.realRecordAttestation) {
    res.status(400).json({ error: "Confirm that this is a real docket observation supported by the stated source." });
    return;
  }
  const textFields = [input.docketNumber, input.county, input.chargeGroup, input.sourceTitle, input.evidenceNote];
  if (textFields.some((value) => !value.trim())) {
    res.status(400).json({ error: "Required details cannot contain only whitespace." });
    return;
  }
  const sourceUrl = new URL(input.sourceUrl);
  if (!["https:", "http:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) {
    res.status(400).json({ error: "Use a source URL with HTTP or HTTPS and no embedded credentials." });
    return;
  }
  const rawOrderDate: unknown = req.body.orderDate;
  if (rawOrderDate !== null && (
    typeof rawOrderDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(rawOrderDate) ||
    input.orderDate?.toISOString().slice(0, 10) !== rawOrderDate
  )) {
    res.status(400).json({ error: "Order date must be an actual calendar date in YYYY-MM-DD format." });
    return;
  }
  const hasTimezone = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!hasTimezone(req.body.sourceRetrievedAt) ||
    (req.body.sourceObservedAt !== null && !hasTimezone(req.body.sourceObservedAt)) ||
    input.sourceRetrievedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    res.status(400).json({ error: "Source timestamps must include a timezone. Source consultation cannot be in the future." });
    return;
  }
  const nonnumeric = ["NONMONETARY", "RECOGNIZANCE", "DENIED", "UNKNOWN"].includes(input.bailCategory);
  if ((nonnumeric && (input.amountCents !== null || input.financialBasis !== null)) ||
    (input.amountCents !== null && input.financialBasis === null)) {
    res.status(400).json({ error: "Use a monetary basis for a numeric amount, and leave nonmonetary conditions unpriced." });
    return;
  }
  if (input.financialBasis !== null && (
    (input.bailCategory === "UNSECURED" && input.financialBasis !== "UNSECURED_AMOUNT") ||
    (input.bailCategory !== "UNSECURED" && input.financialBasis === "UNSECURED_AMOUNT")
  )) {
    res.status(400).json({ error: "Keep unsecured amounts separate from monetary total bail, cash deposits, and surety bond amounts." });
    return;
  }
  const docketNumber = input.docketNumber.trim().toUpperCase();
  const county = input.county.trim();
  const [record] = await db.insert(bailRecordsTable).values({
    ownerId,
    caseKey: `${county.toLowerCase()}|${input.courtLevel}|${docketNumber}`,
    docketNumber,
    county,
    courtLevel: input.courtLevel,
    chargeGroup: input.chargeGroup.trim(),
    bailCategory: input.bailCategory,
    financialBasis: input.financialBasis,
    amountCents: input.amountCents,
    orderDate: rawOrderDate as string | null,
    sourceTitle: input.sourceTitle.trim(),
    sourceUrl: sourceUrl.toString(),
    sourceRetrievedAt: input.sourceRetrievedAt,
    sourceObservedAt: input.sourceObservedAt,
    evidenceNote: input.evidenceNote.trim(),
  }).returning();
  const payload = serializeBailRecord(record!);
  CreateBailRecordResponse.parse(payload);
  res.status(201).json(payload);
});

router.post("/records/:recordId/review", async (req, res): Promise<void> => {
  const params = ReviewBailRecordParams.safeParse(req.params);
  const body = ReviewBailRecordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose a review decision and order interpretation." });
    return;
  }
  const { ownerId, ownerIds } = getWorkspaceIdentity(res);
  try {
    const result = await db.transaction(async (tx) => {
      const [record] = await tx.select().from(bailRecordsTable).where(and(eq(bailRecordsTable.id, params.data.recordId), inArray(bailRecordsTable.ownerId, ownerIds))).for("update");
      if (!record) return { status: 404, error: "Record not found in the shared research workspace." };
      if (record.reviewStatus !== "PENDING") return { status: 409, error: "This observation has already been reviewed. The original evidence is preserved." };
      const interpretation = body.data.decision === "REJECTED" ? "UNRESOLVED" as const : body.data.orderInterpretation;
      if (interpretation === "REVIEWED_OPERATIVE") {
        if (!record.orderDate) return { status: 400, error: "An order date is required before an observation can be interpreted as operative." };
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bail-operative:${record.caseKey}`}))`);
        const [existing] = await tx.select({ id: bailRecordsTable.id }).from(bailRecordsTable).where(and(
          inArray(bailRecordsTable.ownerId, ownerIds),
          eq(bailRecordsTable.caseKey, record.caseKey),
          eq(bailRecordsTable.reviewStatus, "CONFIRMED"),
          eq(bailRecordsTable.orderInterpretation, "REVIEWED_OPERATIVE"),
        ));
        if (existing) return { status: 409, error: "A reviewed operative observation already exists for this docket. Resolve its order history before selecting another." };
      }
      const reviewedAt = new Date();
      const [updated] = await tx.update(bailRecordsTable).set({
        reviewStatus: body.data.decision,
        orderInterpretation: interpretation,
        reviewerId: ownerId,
        reviewedAt,
        reviewComment: body.data.comment?.trim() || null,
      }).where(eq(bailRecordsTable.id, record.id)).returning();
      await tx.insert(bailReviewsTable).values({
        recordId: record.id,
        ownerId: record.ownerId,
        reviewerId: ownerId,
        decision: body.data.decision,
        orderInterpretation: interpretation,
        comment: body.data.comment?.trim() || null,
      });
      return { status: 200, record: updated! };
    });
    if (!("record" in result) || !result.record) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const payload = serializeBailRecord(result.record);
    ReviewBailRecordResponse.parse(payload);
    res.json(payload);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).cause?.code
      ?? (error as { code?: string }).code;
    if (code === "23505") {
      res.status(409).json({ error: "A reviewed operative observation already exists for this docket. No review was committed." });
      return;
    }
    throw error;
  }
});

router.get("/analytics/bail-range", async (req, res): Promise<void> => {
  const parsed = GetBailRangeQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the range filters and try again." });
    return;
  }
  const financialBasis = parsed.data.financialBasis ?? "TOTAL_BAIL";
  const bailCategory = parsed.data.bailCategory ?? "MONETARY";
  const { ownerIds } = getWorkspaceIdentity(res);
  const conditions = [
    ...cohortConditions(ownerIds, parsed.data),
    eq(bailRecordsTable.reviewStatus, "CONFIRMED"),
    eq(bailRecordsTable.orderInterpretation, "REVIEWED_OPERATIVE"),
    eq(bailRecordsTable.bailCategory, bailCategory),
    eq(bailRecordsTable.financialBasis, financialBasis),
    isNotNull(bailRecordsTable.amountCents),
  ];
  const rows = await db.select({
    caseKey: bailRecordsTable.caseKey,
    amountCents: bailRecordsTable.amountCents,
  }).from(bailRecordsTable).where(and(...conditions));
  const amountsByDocket = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.amountCents === null) continue;
    const amountsForDocket = amountsByDocket.get(row.caseKey) ?? new Set<number>();
    amountsForDocket.add(row.amountCents);
    amountsByDocket.set(row.caseKey, amountsForDocket);
  }
  const conflictingDockets = [...amountsByDocket.values()].filter((amountsForDocket) => amountsForDocket.size > 1).length;
  const amounts = [...amountsByDocket.values()]
    .filter((amountsForDocket) => amountsForDocket.size === 1)
    .map((amountsForDocket) => [...amountsForDocket][0]!);
  const range = conflictingDockets > 0 ? descriptiveRange([]) : descriptiveRange(amounts);
  const payload = {
    filters: {
      courtLevel: parsed.data.courtLevel ?? null,
      county: parsed.data.county?.trim() || null,
      chargeGroup: parsed.data.chargeGroup?.trim() || null,
      financialBasis,
      bailCategory,
    },
    reviewedRecordCount: conflictingDockets > 0 ? 0 : amounts.length,
    ...range,
    evaluatedAt: new Date().toISOString(),
    note: conflictingDockets > 0
      ? `${conflictingDockets} docket${conflictingDockets === 1 ? "" : "s"} has conflicting confirmed operative amounts in the shared workspace. Resolve those records before using a shared range; no range is shown.`
      : amounts.length === 0
        ? "No confirmed, reviewed-operative numeric observations match these filters. Saved records only; no live sources were queried."
        : `Descriptive only: one reviewed-operative observation per docket, with the same bail category and monetary basis. Duplicate identical observations from earlier accounts are counted once. Not a recommended bail amount. Sources were consulted at their listed times; there is no live refresh. Median is rounded to the nearest cent.${!parsed.data.county || !parsed.data.courtLevel || !parsed.data.chargeGroup ? " Some cohort filters are unset; observations may span counties, court levels, or charge groups." : ""}${amounts.length < 5 ? " Small comparison set: fewer than five records." : ""}`,
  };
  GetBailRangeResponse.parse(payload);
  res.json(payload);
});

export default router;
