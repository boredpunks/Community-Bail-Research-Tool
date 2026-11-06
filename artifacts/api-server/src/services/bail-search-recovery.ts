export type Recovery = {
  action: "none" | "resume" | "wait" | "evidence_needed" | "new_search" | "source_blocked";
  message: string;
  availableAt: string | null;
};

type RecoveryEvidence = {
  calendarValidated: boolean;
  retainedRows: number;
  documentsDiscovered: number;
  documentsProcessed: number;
  source?: "live" | "saved";
  blockReason?: string | null;
  latestOutcome?: string | null;
  latestStatusCode?: number | null;
  jobMessage?: string | null;
  expiryReason?: string | null;
  missingEvidence?: boolean;
  autoResumeQuota?: boolean;
};

function stageName(input: RecoveryEvidence) {
  if (input.source === "saved") return "Saved evidence processing";
  const calendarValidated = input.calendarValidated;
  return calendarValidated ? "Docket PDF processing" : "Calendar discovery";
}

function observedCause(input: RecoveryEvidence) {
  if (input.source === "saved" && input.missingEvidence)
    return "At least one saved document is unavailable or could not be checked locally.";
  if (input.expiryReason) return `${input.expiryReason}${input.blockReason
    ? " The source is also blocked; its current source-specific recovery requirement remains unresolved."
    : ""}`;
  const block = input.blockReason;
  if (block === "ACCESS_DENIED") return input.latestOutcome === "ACCESS_DENIED"
    ? `This search's latest source request recorded an access denial${input.latestStatusCode ? ` (HTTP ${input.latestStatusCode})` : ""}.`
    : "A retained source access denial is blocking new requests; this search's latest request does not establish that it caused the denial.";
  if (block === "CHALLENGE" || block === "LOGIN_PROMPT") return input.latestOutcome === block
    ? "This search's latest source response presented a verification challenge or sign-in prompt."
    : "A retained source challenge or sign-in block is active; its relationship to this search's latest request is unknown.";
  if (block === "SOURCE_VALIDATION_BARRIER") {
    const code = input.jobMessage?.match(/Source barrier:\s*([A-Z][A-Z0-9_]{2,80})/)?.[1];
    return code
      ? `A source validation barrier is active after the recorded ${code} stop; the source response cause may require review.`
      : "A source validation barrier is active; the original validation cause is unknown from retained evidence.";
  }
  if (block === "ACCESS_UNVERIFIED") return "The required access proof for this source method is missing.";
  if (block === "RESPONSE_DETERIORATION") return "A sustained slow-response safeguard stopped further requests.";
  if (block === "TIMEOUT") return input.latestOutcome === "TIMEOUT"
    ? "This search's latest source request timed out; the source does not confirm what completed."
    : "A source timeout is retained as the active block; this search's latest request does not establish that it caused the timeout.";
  if (block === "NETWORK_ERROR") return input.latestOutcome === "NETWORK_ERROR"
    ? "This search's latest source request ended with a network error; its underlying cause is unknown."
    : "A source network error is retained as the active block; its relationship to this search's latest request is unknown.";
  if (block === "HTTP_ERROR") return input.latestOutcome === "HTTP_ERROR"
    ? `This search's latest source response was HTTP ${input.latestStatusCode ?? "error"}; the underlying cause is unknown.`
    : "An HTTP error is retained as the active source block; its relationship to this search's latest request is unknown.";
  if (block === "INVALID_PDF") return "The retrieved document did not validate as a usable PDF.";
  if (block === "UNSUPPORTED_RESPONSE") return "The source returned a response format this search could not validate.";
  if (block === "SIZE_LIMIT") return "The source response exceeded the accepted size limit.";
  if (block === "REQUEST_IN_FLIGHT" || block === "UNCERTAIN_SOURCE_STATE" || block === "RESTART_IN_FLIGHT")
    return "The source request state is still in flight or uncertain.";
  if (block === "HOURLY_REQUEST_LIMIT") return "The shared hourly request limit has been reached.";
  if (block === "DAILY_REQUEST_LIMIT") return "The shared daily request limit has been reached.";
  if (block === "SOURCE_COOLDOWN" || block === "RATE_LIMIT") return "The source is in a recorded cooldown.";
  if (block) return "The source admission check remains blocked; the specific cause is not established by retained evidence.";

  const outcome = input.latestOutcome;
  if (outcome === "TIMEOUT") return "The last source request timed out; the source does not confirm what completed.";
  if (outcome === "NETWORK_ERROR") return "The last source request ended with a network error; its underlying cause is unknown.";
  if (outcome === "CHALLENGE" || outcome === "LOGIN_PROMPT") return "The last source response presented a verification challenge or sign-in prompt.";
  if (outcome === "ACCESS_DENIED") return `The last source response was an access denial${input.latestStatusCode ? ` (HTTP ${input.latestStatusCode})` : ""}.`;
  if (outcome === "RATE_LIMIT") return "The last source response reported rate limiting.";
  if (outcome === "HTTP_ERROR") return `The last source response was HTTP ${input.latestStatusCode ?? "error"}; the underlying cause is unknown.`;
  if (outcome === "INVALID_PDF") return "The retrieved document did not validate as a usable PDF.";
  if (outcome === "UNSUPPORTED_RESPONSE") return "The source returned a response format this search could not validate.";
  if (outcome === "SIZE_LIMIT") return "The source response exceeded the accepted size limit.";
  if (outcome?.startsWith("UNCERTAIN_")) return "The request outcome is uncertain; it may have reached the source.";

  const message = input.jobMessage ?? "";
  const known = [
    ["RESULTS_EXPIRED", "This checkpoint expired; dockets already in shared Review and Candidates remain."],
    ["JOB_REQUEST_LIMIT", "This search used its full source-request budget."],
    ["CALENDAR_NOT_VALIDATED", "Calendar validation did not finish, so docket processing could not begin."],
    ["DOCUMENT_CAP_REACHED", "This search reached its original document cap."],
    ["SOURCE_COOLDOWN", "The source is in a recorded cooldown."],
    ["PARENT_DENIED", "The scheduler denied the next request before it was sent."],
    ["ROW_VALIDATION_ONLY", "The calendar response contained rows that could not be validated."],
    ["SOURCE_VALIDATION_BARRIER", "Source validation stopped further requests."],
  ] as const;
  const match = known.find(([code]) => message.includes(code));
  if (match) return match[1];
  if (/worker stopped|server restarted|local worker failure|processing stopped/i.test(message))
    return "The worker stopped, but the cause is unknown from retained job and request records.";
  return "The stop is confirmed, but its cause is unknown from retained job and request records.";
}

const timedAdmissionBlocks = new Set([
  "SOURCE_COOLDOWN", "RATE_LIMIT", "HOURLY_REQUEST_LIMIT", "DAILY_REQUEST_LIMIT",
  "TIMEOUT", "NETWORK_ERROR", "RESTART_IN_FLIGHT", "UNCERTAIN_SOURCE_STATE",
  "UNCERTAIN_AFTER_RESTART", "UNCERTAIN_AFTER_WORKER",
]);

export function recoveryWaitForAdmission(
  blockReason: string | null,
  candidates: readonly (Date | null | undefined)[],
  now = new Date(),
) {
  if (!blockReason || !timedAdmissionBlocks.has(blockReason)) return null;
  const futureTimes = candidates.flatMap(value => value && Number.isFinite(value.getTime())
    && value > now ? [value.getTime()] : []);
  return futureTimes.length ? new Date(Math.max(...futureTimes)) : null;
}

function retainedSummary(input: RecoveryEvidence) {
  const singleRow = input.retainedRows === 1;
  const rows = singleRow ? "1 docket row" : `${input.retainedRows} docket rows`;
  if (input.source === "saved") return `${rows} ${singleRow ? "is" : "are"} retained from the saved evidence set.`;
  const documents = `${input.documentsProcessed} of ${input.documentsDiscovered} discovered PDFs processed`;
  return input.calendarValidated
    ? `${rows} from the validated calendar; ${documents} are retained.`
    : `${rows} ${singleRow ? "is" : "are"} retained; the calendar is not validated, so no zero-result conclusion is available.`;
}

function explanation(input: RecoveryEvidence, nextAction: string) {
  const effect = input.source === "saved"
    ? "The saved evidence set is incomplete; unchecked or unavailable local documents remain unfinished."
    : input.calendarValidated
    ? "The search is incomplete; pending docket checks and any unprocessed PDFs remain unfinished."
    : "No validated docket total is available; this is not a confirmed empty search.";
  return `${stageName(input)} stopped. ${observedCause(input)} ${effect} ${retainedSummary(input)} Next: ${nextAction}`;
}

export function chooseRecovery(input: {
  paused: boolean;
  saved: boolean;
  missingEvidence: boolean;
  expired: boolean;
  noJob: boolean;
  sourceBlocked: boolean;
  cooldown: Date | null;
  now?: Date;
  evidence?: RecoveryEvidence;
}): Recovery {
  const now = input.now ?? new Date();
  if (!input.paused) return { action: "none", message: "", availableAt: null };
  const evidence = {
    calendarValidated: false, retainedRows: 0, documentsDiscovered: 0, documentsProcessed: 0,
    ...input.evidence,
    source: input.evidence?.source ?? (input.saved ? "saved" : "live"),
    missingEvidence: input.missingEvidence,
  };
  if (input.saved && input.missingEvidence) return {
    action: "evidence_needed",
    message: explanation(evidence,
      "Use Advanced court search or enter verified evidence, then start a new collected-evidence search."),
    availableAt: null,
  };
  if (input.expired || input.noJob) return {
    action: "new_search",
    message: explanation(evidence, input.sourceBlocked
      ? "The original dates and request budget cannot be extended. Resolve the current source restriction before starting a new eligible search."
      : "Start a new eligible search. The original dates and request budget cannot be extended."),
    availableAt: null,
  };
  if (input.sourceBlocked) return {
    action: "source_blocked",
    message: explanation(evidence,
      "Do not retry or change request methods. Resolve the stated source requirement with the workspace coordinator; existing results remain available."),
    availableAt: null,
  };
  if (input.cooldown && input.cooldown > now) return {
    action: "wait",
    message: explanation(evidence,
      evidence.autoResumeQuota
        ? `This same search will continue automatically after the shared quota window clears (currently expected ${input.cooldown.toISOString()}). Its scope and remaining budget are unchanged.`
        : `Wait until ${input.cooldown.toISOString()}, then check this same search again. Its scope and remaining budget are unchanged.`),
    availableAt: input.cooldown.toISOString(),
  };
  return {
    action: "resume",
    message: explanation(evidence,
      input.saved
        ? "Resume local processing of this same saved evidence set; no court request will be made."
        : "Resume this same search within its original dates and remaining request budget."),
    availableAt: null,
  };
}
