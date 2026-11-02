export type SharedQuotaBlock = "HOURLY_REQUEST_LIMIT" | "DAILY_REQUEST_LIMIT";

import { rollingUsage } from "../lib/discovery-safety";

const marker = /\[AUTO_RESUME_QUOTA:(HOURLY_REQUEST_LIMIT|DAILY_REQUEST_LIMIT)\]$/;

export function quotaResumeReason(block: string, message?: string | null) {
  if (block !== "HOURLY_REQUEST_LIMIT" && block !== "DAILY_REQUEST_LIMIT") return null;
  const interval = block === "HOURLY_REQUEST_LIMIT" ? "hourly" : "daily";
  return `The shared ${interval} request limit paused this search. It will continue automatically when quota is available; the original scope and remaining budget are unchanged.${message ? ` ${message}` : ""} [AUTO_RESUME_QUOTA:${block}]`;
}

export function autoResumeQuotaBlock(reason: string | null | undefined): SharedQuotaBlock | null {
  return marker.exec(reason ?? "")?.[1] as SharedQuotaBlock | undefined ?? null;
}

export function visibleSearchPauseReason(reason: string | null) {
  return reason?.replace(/\s*\[AUTO_RESUME_QUOTA:(?:HOURLY_REQUEST_LIMIT|DAILY_REQUEST_LIMIT)\]$/, "") ?? null;
}

export function isLegacySchedulerPause(reason: string | null) {
  return reason === "The scheduler denied a source request before transmission. Original source state and budgets retained; no validation barrier added.";
}

export function isLegacyQuotaPause(reason: string | null) {
  return isLegacySchedulerPause(reason)
    || /^(?:HOURLY_REQUEST_LIMIT|DAILY_REQUEST_LIMIT); next eligible \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z:/.test(reason ?? "");
}

export function legacyQuotaResumeBlock(
  reason: string | null,
  resumeAt: Date | null,
  pausedAt: Date,
  starts: Date[],
): SharedQuotaBlock | null {
  if (!resumeAt || !Number.isFinite(resumeAt.getTime()) || !Number.isFinite(pausedAt.getTime())) return null;
  const recordedLimit = /^(HOURLY_REQUEST_LIMIT|DAILY_REQUEST_LIMIT); next eligible (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z):/.exec(reason ?? "");
  if (recordedLimit) {
    const recordedRelease = Date.parse(recordedLimit[2]!);
    return Number.isFinite(recordedRelease) && Math.abs(resumeAt.getTime() - recordedRelease) <= 120_000
      ? recordedLimit[1] as SharedQuotaBlock
      : null;
  }
  if (!isLegacySchedulerPause(reason)) return null;
  // These were the shared defaults before the quota-wait marker was introduced.
  const previousUsage = rollingUsage(starts, pausedAt, 30, 120);
  const block = previousUsage.blockedReason;
  const release = previousUsage.nextEligibleAt;
  if ((block !== "HOURLY_REQUEST_LIMIT" && block !== "DAILY_REQUEST_LIMIT") || !release) return null;
  return Math.abs(resumeAt.getTime() - release.getTime()) <= 120_000 ? block : null;
}
