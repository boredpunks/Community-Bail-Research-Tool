export type SharedQuotaBlock = "HOURLY_REQUEST_LIMIT" | "DAILY_REQUEST_LIMIT";

import { rollingUsage } from "../lib/discovery-safety";

const marker = /\[AUTO_RESUME_QUOTA:(HOURLY_REQUEST_LIMIT|DAILY_REQUEST_LIMIT)\]$/;
const transportMarker = /\[AUTO_RESUME_TRANSPORT:(TIMEOUT|NETWORK_ERROR)\]$/;

export function quotaResumeReason(block: string, message?: string | null) {
  if (block !== "HOURLY_REQUEST_LIMIT" && block !== "DAILY_REQUEST_LIMIT") return null;
  const interval = block === "HOURLY_REQUEST_LIMIT" ? "hourly" : "daily";
  return `The shared ${interval} request limit paused this search. It will continue automatically when quota is available; the original scope and remaining budget are unchanged.${message ? ` ${message}` : ""} [AUTO_RESUME_QUOTA:${block}]`;
}

export function transportAutoResumeReason(
  block: string | null | undefined,
  latestOutcome: string | null | undefined,
  cooldownUntil: Date | null | undefined,
) {
  if ((block !== "TIMEOUT" && block !== "NETWORK_ERROR") || latestOutcome !== block
    || !cooldownUntil || !Number.isFinite(cooldownUntil.getTime())) return null;
  const description = block === "TIMEOUT" ? "timeout" : "network failure";
  return `This same search will continue automatically after its recorded ${description} cooldown and when all source checks pass. Its original scope and remaining request budget are unchanged. [AUTO_RESUME_TRANSPORT:${block}]`;
}

export function autoResumeQuotaBlock(reason: string | null | undefined): SharedQuotaBlock | null {
  return marker.exec(reason ?? "")?.[1] as SharedQuotaBlock | undefined ?? null;
}

export function autoResumeTransportBlock(reason: string | null | undefined): "TIMEOUT" | "NETWORK_ERROR" | null {
  return transportMarker.exec(reason ?? "")?.[1] as "TIMEOUT" | "NETWORK_ERROR" | undefined ?? null;
}

export function autoResumeBlock(reason: string | null | undefined) {
  return autoResumeQuotaBlock(reason) ?? autoResumeTransportBlock(reason);
}

export function visibleSearchPauseReason(reason: string | null) {
  return reason?.replace(/\s*\[AUTO_RESUME_(?:QUOTA:(?:HOURLY_REQUEST_LIMIT|DAILY_REQUEST_LIMIT)|TRANSPORT:(?:TIMEOUT|NETWORK_ERROR))\]$/, "") ?? null;
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
