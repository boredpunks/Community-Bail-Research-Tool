import { validCalendarResponseSize } from "./calendar-response-metadata";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, pool, discoveryAssessmentsTable, discoveryItemsTable, discoveryJobsTable, discoveryRequestsTable, discoverySourceTable, type DiscoveryJobRow, type DiscoveryEntryData } from "@workspace/db";
import { actualDate, discoveryEvent, discoveryPolicy, jobSummary } from "./discovery";
import {
  allowedSourceRequest, validCalendarDocketLink, calendarAuditHeaders, calendarPreviewMethod,
  calendarPreviewRequestAllowed, isCalendarPreviewCriteria,
  validCalendarAuditHeaders,
  validCalendarDiagnostics, validCalendarFormDiagnostic, calendarDiagnosticRejection,
} from "./discovery-safety";
import { GetDiscoveryJobResponse } from "@workspace/api-zod";
import { documentLocations } from "./document-locations";
import { isExplicitEmptyCalendarLayout, validCalendarLayout } from "./calendar-layout";
import { finishBoundedRun } from "./bounded-report";
import { logger } from "./logger";
import { clearExpiredDiscoveryResults } from "./discovery-retention";
import { accountSourceResponse, recoverUncertainRequests, reserveSourceRequest } from "./discovery-scheduler";
import { formInspectionMethod, validInspectionMetadata } from "./form-inspection";
import { coverageInspectionMethod, coveragePhases, validCoverageMetadata } from "./coverage-inspection";
import { filingInspectionMethod, filingPhases, validFilingInventoryMetadata } from "./filing-inspection";
import { InspectionFetchBroker } from "./inspection-fetch-broker";
import { validCalendarRowDates } from "./calendar-criteria";
import { courtroomObservationMethod, courtroomObservationDeadlineMs, validCourtroomObservationCriteria,
  validCourtroomObservationMetadata } from "./courtroom-observation";
import { boundedEngineMethod, boundedObservationCanContinue, boundedObservationRequestAllowed,
  validBoundedEngineCriteria } from "./bounded-engine";
import { validCalendarResponseDiagnostic } from "./calendar-response-diagnostics";
import { researchMethod, validResearchCriteria } from "./research-scope";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let activeChild: ChildProcessWithoutNullStreams | null = null;
let stopping = false;
const sourceId = "UJS";

async function pause(job: DiscoveryJobRow, message: string) {
  await db.update(discoveryJobsTable).set({ status: "PAUSED", message, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
  await discoveryEvent(job, "PAUSE", message);
}

export async function grant(job: DiscoveryJobRow, requestPath: unknown, method: unknown, permitId?: string | number, url?: unknown) {
  return reserveSourceRequest(job, requestPath, method, permitId, url, () => stopping);
}

export async function sourceOutcome(job: DiscoveryJobRow, message: Record<string, unknown>) {
  return accountSourceResponse(job, message);
}

async function validationStop(reason: string) {
  await db.transaction(async (tx) => {
    const [source] = await tx.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId)).for("update");
    // Preserve the original network stop and Retry-After, including a 429
    // followed by a retrieval-failed message from the same download.
    if (source && !source.blockedReason) await tx.update(discoverySourceTable).set({
      blockedReason: reason, accessVerifiedAt: null, verifiedMethod: null, collectionApprovedAt: null,
    }).where(eq(discoverySourceTable.id, sourceId));
    await tx.update(discoveryJobsTable).set({ status: "PAUSED", updatedAt: new Date(), message: `${reason}: source validation stopped collection; no next request.` }).where(inArray(discoveryJobsTable.status, ["RUNNING", "QUEUED"]));
  });
}

const extractionProvenance = GetDiscoveryJobResponse.shape.items.element.shape.provenance;

export async function runJob(job: DiscoveryJobRow, permitId?: string) {
  if (job.assessmentId !== (permitId ?? null)) throw new Error("Assessment runner scope mismatch");
  const [permit] = permitId ? await db.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, permitId)) : [];
  const inspectionOnly = permit?.stage === "INSPECT" && permit.expectedMethod === formInspectionMethod;
  if (permit?.stage === "INSPECT" && !inspectionOnly)
    throw new Error("Invalid form inspection client scope");
  const courtroomObservationOnly = permit?.stage === "COVERAGE"
    && permit.expectedMethod === courtroomObservationMethod && validCourtroomObservationCriteria(job.criteria);
  const coverageOnly = permit?.stage === "COVERAGE"
    && (permit.expectedMethod === coverageInspectionMethod || courtroomObservationOnly);
  if (permit?.stage === "COVERAGE" && !coverageOnly) throw new Error("Invalid coverage observation scope");
  const filingInspectionOnly = permit?.stage === "FILING_INSPECT" && permit.expectedMethod === filingInspectionMethod;
  const calendarPreviewOnly = job.criteria.calendarPreviewOnly === true;
  const calendarOnlyPermit = permit?.stage === "CALENDAR_ONLY" && permit.expectedMethod === calendarPreviewMethod;
  const boundedEngine = permit?.stage === "BOUNDED_ENGINE" && permit.expectedMethod === boundedEngineMethod;
  const researchRun = permit?.stage === "RESEARCH_RUN" && permit.expectedMethod === researchMethod
    && validResearchCriteria(job.criteria);
  if (permit?.stage === "RESEARCH_RUN" && !researchRun) throw new Error("Invalid research-run scope");
  if (permit?.stage === "CALENDAR_ONLY"
      && (!calendarOnlyPermit || !calendarPreviewOnly || !isCalendarPreviewCriteria(job.criteria))) {
    throw new Error("Invalid calendar-only operator permit scope");
  }
  if (calendarPreviewOnly && ((job.assessmentId && !calendarOnlyPermit) || inspectionOnly || coverageOnly || filingInspectionOnly
      || job.calendarComplete || !isCalendarPreviewCriteria(job.criteria))) {
    throw new Error("Invalid calendar preview worker scope");
  }
  if (permit?.stage === "BOUNDED_ENGINE"
    && (permit.expectedMethod !== boundedEngineMethod || !validBoundedEngineCriteria(job.criteria)))
    throw new Error("Invalid bounded engine permit scope");
  const diagnosticOnly = inspectionOnly || coverageOnly || filingInspectionOnly;
  const [running] = await db.update(discoveryJobsTable).set({ status: "RUNNING", message: "Starting one paced browser session. Asset traffic counts against your budget.", updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "QUEUED"))).returning();
  if (!running) return;
  await discoveryEvent(job, "START", "Worker acquired this job; original query and ordering retained.");
  const items = await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, job.id)).orderBy(asc(discoveryItemsTable.position));
  const processed = items.filter((item) => item.provenance.extractionOutcome !== "UNPROCESSED").length;
  const initialCounts = await jobSummary(running);
  if (initialCounts.targetReached) {
    await db.update(discoveryJobsTable).set({ status: "COMPLETED", message: `Matching target reached (${initialCounts.matching}/${running.criteria.matchTarget}). No further downloads.`, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
    return;
  }
  if (processed >= job.criteria.recordCap) {
    await db.update(discoveryJobsTable).set({ status: "COMPLETED", message: "Explicit record cap reached; remaining discovered dockets were not processed.", updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
    return;
  }
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ujs", "worker.py");
  const args = inspectionOnly
    ? [path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ujs", "network_sandbox.py"), script]
    : ["-u", script];
  const child = spawn("python", args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
  activeChild = child;
  let observationTimedOut = false;
  const observationTimer = courtroomObservationOnly ? setTimeout(() => {
    observationTimedOut = true;
    if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* Exited. */ }
  }, courtroomObservationDeadlineMs) : null;
  observationTimer?.unref();
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  let finished = false;
  const inspectionBroker = inspectionOnly ? new InspectionFetchBroker() : null;
  let inspectionPhase: "NONE" | "BEFORE" = "NONE";
  let coveragePhase = 0;
  let filingPhase = 0;
  let boundedObservationRequests = 0;
  let boundedObservationSeen = false;
  let boundedObservationComplete = false;
  let explicitEmptyLayoutSeen = false;
  let explicitEmptyDiagnosticSeen = false;
  let calendarLayoutSeen = false;
  let calendarResponseDiagnosticSeen = false;
  let stderrBytes = 0;
  child.stderr.on("data", (buffer: Buffer) => { stderrBytes += buffer.length; }); // Never log source/cookie/PDF text.
  child.stdin.write(JSON.stringify({
    criteria: job.criteria, calendarComplete: job.calendarComplete, inspectionOnly, coverageOnly, filingInspectionOnly,
     calendarPreviewOnly, ordinaryCalendar: calendarPreviewOnly && !job.assessmentId,
     courtroomObservationOnly, boundedEngineObservation: boundedEngine, researchRun,
    pendingItems: items.filter((item) => item.provenance.extractionOutcome === "UNPROCESSED").map((item) => ({ docketNumber: item.docketNumber, sourceUrl: item.sourceUrl })),
    remainingRecords: calendarPreviewOnly ? 0 : job.criteria.recordCap - processed,
  }) + "\n");
  try {
    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      if (line.length > 4_000_000) throw new Error("Worker message exceeds bound");
      const message = JSON.parse(line) as Record<string, unknown>;
      if (finished) throw new Error("Worker message after completion");
      if (inspectionOnly && !["request", "response", "inspection_metadata",
        "inspection_finished", "calendar_diagnostics", "calendar_state", "barrier"].includes(String(message.kind)))
        throw new Error("Inspection cannot emit collection results");
      if (coverageOnly && !["request", "response", ...(courtroomObservationOnly
        ? ["courtroom_metadata", "calendar_form_diagnostic"] : ["coverage_metadata"]), "coverage_finished",
        "calendar_diagnostics", "calendar_state", "barrier"].includes(String(message.kind)))
        throw new Error("Coverage inspection cannot emit collection results");
      if (filingInspectionOnly && !["request", "response", "filing_metadata", "filing_finished",
        "calendar_diagnostics", "calendar_state", "barrier"].includes(String(message.kind)))
        throw new Error("Filing inspection cannot emit collection results");
      if (message.kind === "request") {
        if (diagnosticOnly && (inspectionPhase !== "NONE" || coveragePhase > 0 || filingPhase > 0)) throw new Error("Inspection transmission after bootstrap");
        if (boundedEngine && !boundedObservationRequestAllowed(
          boundedObservationComplete, boundedObservationRequests, message.path, message.method)) {
          child.stdin.write(JSON.stringify({ allow: false, reason: "COURTROOM_OBSERVATION_REQUEST_LIMIT" }) + "\n");
          continue;
        }
        if (calendarPreviewOnly && !calendarPreviewRequestAllowed(message.path, message.method))
          throw new Error("Calendar preview cannot retrieve docket documents");
        const permission = inspectionOnly
          ? await inspectionBroker!.handle(message, (requestPath, method, url) =>
            grant(job, requestPath, method, permitId, url))
          : await grant(job, message.path, message.method, permitId, message.url);
        if (boundedEngine && !boundedObservationComplete && permission.allow) boundedObservationRequests++;
        child.stdin.write(JSON.stringify(permission) + "\n");
      } else if (message.kind === "response") {
        if (inspectionOnly && !inspectionBroker!.acknowledge(message))
          throw new Error("Inspection response accounting mismatch");
        child.stdin.write(JSON.stringify({ continue: await sourceOutcome(job, message) }) + "\n");
      } else if (message.kind === "calendar_response_size") {
        if (diagnosticOnly || !validCalendarResponseSize(message))
          throw new Error("Invalid calendar response-size metadata");
        await discoveryEvent(job, "CALENDAR_RESPONSE_SIZE", JSON.stringify(message));
      } else if (message.kind === "filing_metadata") {
        if (!filingInspectionOnly || !validFilingInventoryMetadata(message) || message.phase !== filingPhases[filingPhase])
          throw new Error("Invalid filing metadata");
        filingPhase++;
        await discoveryEvent(job, "FILING_METADATA", JSON.stringify(message));
      } else if (message.kind === "filing_finished") {
        if (!filingInspectionOnly || filingPhase !== filingPhases.length || Object.keys(message).length !== 1)
          throw new Error("Incomplete filing inspection");
        finished = true;
      } else if (message.kind === "courtroom_metadata") {
        const boundedObservation = boundedEngine && !boundedObservationSeen;
        if ((!courtroomObservationOnly && !boundedObservation)
          || courtroomObservationOnly && coveragePhase !== 0 || !validCourtroomObservationMetadata(message))
          throw new Error("Invalid courtroom observation metadata");
        if (boundedObservation) {
          boundedObservationSeen = true;
          boundedObservationComplete = boundedObservationCanContinue(message.outcome, boundedObservationRequests);
        } else coveragePhase++;
        await discoveryEvent(job, "COURTROOM_METADATA", JSON.stringify(message));
      } else if (message.kind === "bounded_engine_stopped") {
        if (!boundedEngine || !["COURTROOM_BINDING_NOT_ESTABLISHED", "COURTROOM_OBSERVATION_REQUEST_LIMIT"].includes(String(message.code))
          || job.calendarComplete) throw new Error("Invalid bounded engine stop");
        await pause(job, `${String(message.code)}: no Search or document request was authorized.`);
        finished = true;
      } else if (message.kind === "coverage_metadata") {
        if (!coverageOnly || courtroomObservationOnly || !validCoverageMetadata(message) || message.phase !== coveragePhases[coveragePhase])
          throw new Error("Invalid coverage metadata");
        coveragePhase++;
        await discoveryEvent(job, "COVERAGE_METADATA", JSON.stringify(message));
      } else if (message.kind === "coverage_finished") {
        if (!coverageOnly || coveragePhase !== (courtroomObservationOnly ? 1 : coveragePhases.length) || Object.keys(message).length !== 1)
          throw new Error("Incomplete coverage inspection");
        finished = true;
      } else if (message.kind === "inspection_metadata") {
        if (!inspectionOnly || !validInspectionMetadata(message)
          || inspectionPhase !== "NONE" || message.phase !== "BEFORE")
          throw new Error("Invalid inspection metadata");
        inspectionPhase = "BEFORE";
        await discoveryEvent(job, "INSPECTION_METADATA", JSON.stringify(message));
      } else if (message.kind === "inspection_finished") {
        if (!inspectionOnly || inspectionPhase !== "BEFORE" || Object.keys(message).length !== 1)
          throw new Error("Incomplete inspection");
        finished = true;
      } else if (message.kind === "calendar_state") {
        if (diagnosticOnly && ["FORM_READY", "RESULTS_VALIDATED", "EMPTY_RESULTS_VALIDATED"].includes(String(message.state)))
          throw new Error("Inspection cannot claim submitted results");
        const states = ["FORM_READY", "SUBMISSION_NOT_OBSERVED", "FORM_VALIDATION_ERROR",
          "RESULTS_VALIDATED", "EMPTY_RESULTS_VALIDATED", "ACCESS_DENIED", "UNEXPECTED_RESPONSE",
          "RESULTS_NOT_VALIDATED"];
        if (!states.includes(String(message.state))
          || !(typeof message.formVisible === "boolean" || message.formVisible === null)) {
          throw new Error("Invalid calendar state evidence");
        }
        if (message.state === "EMPTY_RESULTS_VALIDATED"
          && (!explicitEmptyLayoutSeen || !explicitEmptyDiagnosticSeen))
          throw new Error("Explicit empty-result status lacks matching validated source evidence");
        await discoveryEvent(job, "CALENDAR_STATE",
          `${String(message.state)}; Search button visible=${message.formVisible === null ? "not observed" : message.formVisible}. No form values, row identifiers, or response content retained.`);
      } else if (message.kind === "calendar_form_diagnostic") {
        if (!validCalendarFormDiagnostic(message)) throw new Error("Invalid public form diagnostic");
        await discoveryEvent(job, "CALENDAR_FORM_DIAGNOSTIC",
          `${message.phase ?? "PHASE_NOT_REPORTED"}: ${message.code}: ${message.control} / ${message.reason}. Fixed labels only; no field values, hidden tokens or source text retained.`);
      } else if (message.kind === "calendar_diagnostics") {
        if (!validCalendarDiagnostics(message)) throw new Error("Invalid calendar diagnostics");
        await discoveryEvent(job, "CALENDAR_DIAGNOSTIC",
          `${message.phase}: known script loaded=${message.scriptLoaded}; stylesheet loaded=${message.stylesheetLoaded}; blocked scripts=${message.blockedScripts}, stylesheets=${message.blockedStylesheets}, document/data requests=${message.blockedRequests}; script errors=${message.pageErrors}, unclassified console errors=${message.consoleErrors}, proven optional-abort console errors=${message.optionalConsoleErrors}; network requests=${message.networkRequests ?? "not reported"}, cached asset responses=${message.cachedResponses ?? "not reported"}. Counts only; no source content retained.`);
      } else if (message.kind === "calendar_response_diagnostic") {
        if (diagnosticOnly || boundedEngine && !boundedObservationComplete
          || calendarResponseDiagnosticSeen || !validCalendarResponseDiagnostic(message))
          throw new Error("Invalid calendar response diagnostic");
        calendarResponseDiagnosticSeen = true;
        if (message.documentEligibility === "VALIDATED_EMPTY") {
          const result = message.resultValidation as Record<string, unknown>;
          const structure = message.structure as Record<string, unknown>;
          if (!explicitEmptyLayoutSeen || result.outcome !== "VALIDATED_EMPTY"
            || result.explicitEmptyResult !== "SOURCE_STATUS_MARKER")
            throw new Error("Empty-result diagnostic lacks the observed source status row");
          if (structure.resultTableCount !== 1 || structure.headerCellCount !== 19
            || structure.dataRowCount !== 1 || structure.documentLinkCount !== 0
            || structure.expectedHeaders !== true || structure.countsCapped !== false)
            throw new Error("Empty-result diagnostic conflicts with the observed table structure");
          explicitEmptyDiagnosticSeen = true;
        }
        await discoveryEvent(job, "CALENDAR_RESPONSE_DIAGNOSTIC", JSON.stringify(message));
        const transport = message.transportIntegrity as {
          status: string; requiredAssetsLoaded: boolean; requestFailureObserved: boolean;
          blockedDuringInspection: number;
        };
        const console = message.consoleDiagnostics as {
          status: string; consoleErrors: number; runtimeExceptions: number; provenOptionalErrors: number;
        };
        const result = message.resultValidation as {
          outcome: string; observedRows: number; validatedRows: number; validatedDockets: number;
          documentLinks: string; scope: string; dates: string; explicitEmptyResult: string;
        };
        await discoveryEvent(job, "CALENDAR_RESULT_REVIEW", [
          `Transport/resource integrity: ${transport.status}; required assets loaded=${transport.requiredAssetsLoaded}; request failure observed=${transport.requestFailureObserved}; requests blocked during read-only inspection=${transport.blockedDuringInspection}.`,
          `Console/runtime diagnostics: ${console.status}; unclassified console errors=${console.consoleErrors}; runtime exceptions=${console.runtimeExceptions}; proven optional aborts=${console.provenOptionalErrors}.`,
          `Response structure and result validation: ${result.outcome}; intercepted Search body check=${String(message.criteriaValidation)}; source rows=${result.observedRows}; rows validated=${result.validatedRows}; distinct dockets=${result.validatedDockets}; document links=${result.documentLinks}; office/event/date scope=${result.scope}; date window=${result.dates}; explicit empty-result evidence=${result.explicitEmptyResult}.`,
          `Document retrieval eligibility: ${String(message.documentEligibility)}.`,
        ].join("|"));
      } else if (message.kind === "calendar_layout") {
        if (diagnosticOnly || calendarLayoutSeen || !validCalendarLayout(message))
          throw new Error("Invalid calendar layout projection");
        calendarLayoutSeen = true;
        explicitEmptyLayoutSeen = isExplicitEmptyCalendarLayout(message);
        await discoveryEvent(job, "CALENDAR_LAYOUT", JSON.stringify(message));
      } else if (message.kind === "calendar") {
        if (boundedEngine && !boundedObservationComplete) throw new Error("Courtroom observation gate missing before Search results");
        if (calendarPreviewOnly !== (job.criteria.calendarPreviewOnly === true)) throw new Error("Calendar mode mismatch");
        const rows = message.rows as {
          docketNumber: string; position: number; sourceUrl: string; eventDate: string | null;
          filingDate: string | null; eventType: string; courtOffice: string;
          courtType: "MDJ" | "COMMON_PLEAS" | "UNSUPPORTED";
          matchingEvents?: NonNullable<import("@workspace/db").DiscoveryProvenanceData["matchingEvents"]>;
        }[];
        if (!Array.isArray(rows) || rows.length > 5000 || typeof message.retrievedAt !== "string"
          || !Number.isFinite(Date.parse(message.retrievedAt))
          || rows.length === 0 && (!explicitEmptyLayoutSeen || !explicitEmptyDiagnosticSeen)
          || calendarPreviewOnly && !validCalendarAuditHeaders(message.columnHeaders)) {
          throw new Error("Invalid calendar checkpoint");
        }
        await db.transaction(async (tx) => {
          for (const row of rows) {
            const docketType = /^CP-02-CR-\d{7}-\d{4}$/.test(row.docketNumber) ? "COMMON_PLEAS"
              : /^MJ-\d{5}-(CR|NT)-\d{7}-\d{4}$/.test(row.docketNumber) ? "MDJ" : null;
            if (!validCalendarDocketLink(row.sourceUrl, row.docketNumber)
              || !["MDJ", "COMMON_PLEAS", "UNSUPPORTED"].includes(row.courtType)
              || docketType !== null && row.courtType !== "UNSUPPORTED" && row.courtType !== docketType
              || typeof row.courtOffice !== "string" || !row.courtOffice.trim()
              || row.courtOffice.length > 80 || /[\u0000-\u001f\u007f]/.test(row.courtOffice)
              || !Number.isSafeInteger(row.position) || row.position < 0
               || !validCalendarRowDates(row, job.criteria,
                  (job.criteria.resultVersion === 2 || calendarPreviewOnly && !!job.assessmentId || permit?.stage === "BOUNDED_ENGINE")
                   && !(job.criteria.courtOffice === "ANY" && job.criteria.eventType === "ANY"
                     && job.criteria.courtRoom === "ANY"))
              || typeof row.eventType !== "string" || !row.eventType.length || row.eventType.length > 160
              || job.criteria.eventType !== "ANY" && row.eventType !== job.criteria.eventType)
              throw new Error("Calendar identity conflict");
            const { courtOffice, courtType, matchingEvents, ...itemRow } = row;
            if (matchingEvents !== undefined && (!Array.isArray(matchingEvents) || !matchingEvents.length
              || matchingEvents.length > 500 || matchingEvents.some(event =>
                !actualDate(event.eventDate) || event.eventDate < job.criteria.startDate || event.eventDate > job.criteria.endDate
                || typeof event.eventType !== "string" || !event.eventType.length || event.eventType.length > 160
                || job.criteria.eventType !== "ANY" && event.eventType !== job.criteria.eventType
                || event.eventTime != null && (typeof event.eventTime !== "string" || event.eventTime.length > 40)))) throw new Error("Invalid matching calendar events");
            await tx.insert(discoveryItemsTable).values({
              jobId: job.id, ownerId: job.ownerId, ...itemRow,
              provenance: {
                calendarUrl: "https://ujsportal.pacourts.us/CaseSearch", calendarRetrievedAt: message.retrievedAt as string,
                courtOffice, courtType, eventType: row.eventType,
                courtRoom: job.criteria.courtRoom === "ANY" ? null : job.criteria.courtRoom ?? null,
                eventDate: row.eventDate, filingDate: row.filingDate,
                extractionOutcome: courtType === "UNSUPPORTED" ? "UNSUPPORTED_LAYOUT" : "UNPROCESSED",
                postedEntryState: "UNKNOWN", entries: [],
                ...(matchingEvents ? { matchingEvents } : {}),
              },
            }).onConflictDoNothing({ target: [discoveryItemsTable.jobId, discoveryItemsTable.docketNumber] });
          }
          await tx.update(discoveryJobsTable).set({
            calendarComplete: true, paginationComplete: message.paginationComplete === true,
            resultCapReached: message.resultCapReached === true, updatedAt: new Date(),
          }).where(eq(discoveryJobsTable.id, job.id));
        });
        await discoveryEvent(job, "CALENDAR",
          `Validated ${rows.length} distinct result-linked dockets in source order. ${calendarPreviewOnly
            ? `Validated column headers (allowlisted labels only): ${calendarAuditHeaders.join(", ")}. `
            : ""}${message.paginationComplete ? "All locally available rows inspected; no remote pagination detected." : "Pagination or source result cap limits coverage; additional remote pages were not examined."} Traversal: ${["STATIC_DOM", "LOCAL_DATATABLES", "REMOTE_PAGINATION_NOT_TRAVERSED"].includes(String(message.traversal)) ? message.traversal : "LEGACY_UNREPORTED"}. Nonessential assets blocked before transmission: ${Number(message.blockedAssets) || 0}.`);
      } else if (message.kind === "calendar_preview_finished") {
        if (!calendarPreviewOnly || !job.calendarComplete || Object.keys(message).length !== 1)
          throw new Error("Invalid calendar preview completion");
        finished = true;
      } else if (message.kind === "docket") {
        if (calendarPreviewOnly) throw new Error("Calendar preview cannot emit document evidence");
        const [item] = await db.select().from(discoveryItemsTable).where(and(eq(discoveryItemsTable.jobId, job.id), eq(discoveryItemsTable.docketNumber, String(message.docketNumber))));
        if (!item || item.provenance.extractionOutcome !== "UNPROCESSED") continue;
        const outcome = String(message.extractionOutcome);
        const locations = documentLocations(message);
        if (!["EXTRACTED", "MISSING_BAIL_SECTION", "UNREADABLE", "UNSUPPORTED_LAYOUT", "AMBIGUOUS_FINANCIAL_ASSOCIATION", "IDENTITY_MISMATCH", "RETRIEVAL_FAILED"].includes(outcome)) throw new Error("Invalid extraction outcome");
        extractionProvenance.parse({ ...item.provenance, extractionOutcome: outcome, postedEntryState: message.postedEntryState, entries: message.entries, pdfEvents: message.pdfEvents });
        if (message.pdfEvents !== undefined && (!Array.isArray(message.pdfEvents) || message.pdfEvents.some(event =>
          !event || !actualDate(event.eventDate) || typeof event.eventType !== "string" || !event.eventType.trim()
          || event.sourcePage !== undefined && (!Number.isInteger(event.sourcePage) || event.sourcePage < 1 || event.sourcePage > Number(message.documentPageCount))))) throw new Error("Invalid PDF calendar events");
        // Validate, never replace raw calendar-date strings with Zod's coerced Dates.
        if (!(message.retrievedAt === null || typeof message.retrievedAt === "string" && Number.isFinite(Date.parse(message.retrievedAt)))
          || !(message.excerpt === null || typeof message.excerpt === "string" && message.excerpt.length <= 200_000)
          || !(message.detail === null || typeof message.detail === "string" && message.detail.length <= 10_000)
          || (message.entries as DiscoveryEntryData[]).length > 1000
          || (message.entries as DiscoveryEntryData[]).some((entry) => entry.orderDate !== null && !actualDate(entry.orderDate)
            || entry.amountCents !== null && (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0 || entry.amountCents > 2_147_483_647))) throw new Error("Invalid extraction payload");
        if (outcome === "EXTRACTED" && (!(message.entries as unknown[]).length || !message.excerpt || !message.retrievedAt)
          || outcome === "MISSING_BAIL_SECTION" && ((message.entries as unknown[]).length || !message.detail || !message.retrievedAt)) throw new Error("Extraction evidence is incomplete");
        await db.update(discoveryItemsTable).set({
          sourceRetrievedAt: typeof message.retrievedAt === "string" ? new Date(message.retrievedAt) : null,
          excerpt: typeof message.excerpt === "string" ? message.excerpt : null,
          detail: typeof message.detail === "string" ? message.detail : null,
          provenance: { ...item.provenance,
            ...locations,
            extractionOutcome: outcome as typeof item.provenance.extractionOutcome,
            postedEntryState: message.postedEntryState as typeof item.provenance.postedEntryState,
            entries: message.entries as DiscoveryEntryData[],
            ...(message.pdfEvents ? {pdfEvents: message.pdfEvents as import("@workspace/db").DiscoveryProvenanceData["pdfEvents"]} : {}),
          },
        }).where(eq(discoveryItemsTable.id, item.id));
        await discoveryEvent(job, "DOCUMENT", `Document ${item.position + 1}: ${outcome}. PDF disposed after processing. Custody remains unknown.`);
        if (outcome === "IDENTITY_MISMATCH") await validationStop("DOCUMENT_VALIDATION_FAILED");
      } else if (message.kind === "checkpoint") {
        const [current] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id));
        const counts = current ? await jobSummary(current) : null;
        child.stdin.write(JSON.stringify({ continue: current?.status === "RUNNING" && !counts?.targetReached }) + "\n");
      } else if (message.kind === "finished") {
        finished = true;
      } else if (message.kind === "barrier") {
        await validationStop("SOURCE_VALIDATION_BARRIER");
        await pause(job, `Source barrier: ${String(message.code).slice(0, 180)}. Not an empty search. Completed results retained.`);
      } else {
        throw new Error("Unrecognized worker protocol");
      }
    }
    const code = await exit;
    if (observationTimedOut) await pause(job, "Courtroom observation reached its 480-second deadline. Permit consumed; no automatic retry.");
    const [current] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.id, job.id));
    if (current?.status === "RUNNING") {
      if (finished && code === 0) {
        const counts = await jobSummary(current);
        const message = courtroomObservationOnly
          ? "Public courtroom-control observation retained. This is not a submitted search, results, access proof or collection approval. No Search, documents or dependent transmissions; source barrier preserved."
          : filingInspectionOnly
          ? "Bounded public control inventory after filing mode, Advanced Search and local County = Allegheny, including redacted displayed public office codes. No private option values or identities, other county, court/case/office selection, Search, date entry, dependent transmission, remote POST or PDF. Numeric district codes alone do not establish MDJ context or submission bindings; collection remains disabled."
          : coverageOnly
          ? "Public method/office/date metadata inspected. No Search click, remote POST, PDF or result validation. Missing options are not proof of unsupported coverage; source pause unchanged."
          : inspectionOnly
          ? "Public form metadata inspected without invoking form submission. No Search click, POST, results, or PDFs. Not an empty search or access proof; source pause unchanged."
          : current.criteria.calendarPreviewOnly
          ? `Calendar-only preview complete: ${counts.discovered} source-linked row(s) retained. No docket PDFs were requested, no bail evidence was extracted, and this preview cannot be resumed or saved as a candidate.`
          : counts.targetReached
          ? `Matching target reached (${counts.matching}/${current.criteria.matchTarget}). Remaining discovered dockets were not downloaded.`
          : counts.unprocessed > 0
          ? "Explicit record cap reached. Partial docket processing; unprocessed rows remain visible."
          : counts.discovered === 0 ? "Validated result table contained no docket rows. This is a completed empty search, not a returned form."
            : `Returned calendar results exhausted. ${counts.matching} matching docket(s)${current.criteria.matchTarget ? ` of ${current.criteria.matchTarget} requested` : ""}. No date-range expansion; ${current.paginationComplete ? "no remote pagination detected" : "remote pagination/coverage remains incomplete"}. Evidence remains unreviewed; custody unknown.`;
        await db.update(discoveryJobsTable).set({ status: "COMPLETED", message, updatedAt: new Date() }).where(and(eq(discoveryJobsTable.id, job.id), eq(discoveryJobsTable.status, "RUNNING")));
        await discoveryEvent(job, "FINISHED", message);
      } else await pause(job, `Worker stopped before completion (exit ${code}; ${stderrBytes} diagnostic bytes). No automatic retry; partial results retained.`);
    }
  } catch (error) {
    const rejected = calendarDiagnosticRejection(error instanceof Error ? error.message : null);
    if (rejected) await discoveryEvent(job, "PARENT_DIAGNOSTIC_REJECTION",
      `${rejected}. The worker diagnostic was rejected locally; this does not establish a court-form defect. No automatic retry.`);
    await validationStop("WORKER_PROTOCOL_FAILURE");
    throw error;
  } finally {
    if (observationTimer) clearTimeout(observationTimer);
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    }
    activeChild = null;
    const pending = await db.select().from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.jobId, job.id), eq(discoveryRequestsTable.outcome, "IN_FLIGHT"),
    ));
    for (const request of pending) await sourceOutcome(job, {
      requestId: request.id, status: null, outcome: "UNCERTAIN_AFTER_WORKER", retryAfter: null,
    });
  }
}

export async function startDiscoveryWorker() {
  while (!stopping) {
    const lease = await pool.connect();
    let ownsLease = false;
    try {
      const acquired = await lease.query("SELECT pg_try_advisory_lock(74651283) AS acquired");
      if (!acquired.rows[0]?.acquired) { await delay(5000); continue; }
      ownsLease = true;
      await db.insert(discoverySourceTable).values({ id: sourceId }).onConflictDoNothing();
      // Recovery never retries source work silently. Consumed slots stay consumed.
      const interrupted = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.status, "RUNNING"));
      for (const job of interrupted) await pause(job, "Application restarted during collection. Partial results and consumed request slots preserved. Resume explicitly.");
      await db.update(discoveryJobsTable).set({ status: "PAUSED", updatedAt: new Date(),
        message: "Application restarted before queued collection. Resume explicitly; criteria and budgets preserved." })
        .where(eq(discoveryJobsTable.status, "QUEUED"));
      await recoverUncertainRequests();
      // Holding the worker lease proves no pilot runner is active. Interrupted
      // single-use permits are failed, never returned to the approval queue.
      const abandoned = await db.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.state, "ATTEMPTED"));
      for (const permit of abandoned) {
        const requests = permit.jobId ? await db.select().from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, permit.jobId)) : [];
        const items = permit.jobId ? await db.select().from(discoveryItemsTable).where(eq(discoveryItemsTable.jobId, permit.jobId)) : [];
        await db.update(discoveryAssessmentsTable).set({
          state: "FAILED", completedAt: new Date(),
          report: { requests: requests.length, validDocuments: items.filter((item) => ["EXTRACTED", "MISSING_BAIL_SECTION"].includes(item.provenance.extractionOutcome)).length,
            failures: requests.filter((request) => request.outcome !== "OK").length,
            reason: "Runner interrupted. Request/history evidence retained; permit consumed; no automatic retry." },
        }).where(eq(discoveryAssessmentsTable.id, permit.id));
        if (permit.jobId) await db.update(discoveryJobsTable).set({
          status: "PAUSED", updatedAt: new Date(), message: "Pilot interrupted. Single-use permit consumed; a new stage needs separate approval.",
        }).where(and(eq(discoveryJobsTable.id, permit.jobId), inArray(discoveryJobsTable.status, ["QUEUED", "RUNNING"])));
      }
      let cleanupAt = 0;
      while (!stopping) {
        if (Date.now() >= cleanupAt) {
          await clearExpiredDiscoveryResults();
          cleanupAt = Date.now() + 60_000;
        }
        const [job] = await db.select().from(discoveryJobsTable).where(eq(discoveryJobsTable.status, "QUEUED")).orderBy(asc(discoveryJobsTable.createdAt)).limit(1);
        if (job) {
          try {
            if (job.assessmentId) {
              const [permit] = await db.select().from(discoveryAssessmentsTable).where(eq(discoveryAssessmentsTable.id, job.assessmentId));
              if (!permit || permit.state !== "ATTEMPTED" || permit.jobId !== job.id
                || permit.executionOwnerId !== job.ownerId || permit.stage !== "BOUNDED_ENGINE"
                || permit.expectedMethod !== boundedEngineMethod || !validBoundedEngineCriteria(job.criteria)
                || JSON.stringify(permit.criteria) !== JSON.stringify(job.criteria))
                throw new Error("Queued assessment is not an exact delegated bounded scope");
              await runJob(job, permit.id);
              await finishBoundedRun(job.id, permit.id);
            } else await runJob(job);
          }
          catch (error) {
            logger.error({ err: error instanceof Error ? { name: error.name, message: error.message.slice(0, 180) } : undefined }, "Discovery worker stopped a job");
            await pause(job, "Local worker failure. No fabricated results or automatic retries. Operator should inspect setup.");
            if (job.assessmentId) {
              await db.update(discoveryAssessmentsTable).set({
                state: "FAILED", completedAt: new Date(),
                report: { requests: (await db.select().from(discoveryRequestsTable).where(eq(discoveryRequestsTable.jobId, job.id))).length,
                  validDocuments: 0, failures: 0, reason: "Local worker failure. Permit consumed; inspect retained evidence. No automatic retry." },
              }).where(and(eq(discoveryAssessmentsTable.id, job.assessmentId), eq(discoveryAssessmentsTable.state, "ATTEMPTED")));
            }
          }
        } else await delay(1000);
      }
    } catch (error) {
      logger.error({ err: error instanceof Error ? { name: error.name } : undefined }, "Discovery worker unavailable");
      await delay(5000);
    } finally {
      if (ownsLease) await lease.query("SELECT pg_advisory_unlock(74651283)");
      lease.release();
    }
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  stopping = true;
  if (activeChild?.pid) {
    try { process.kill(-activeChild.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
});
