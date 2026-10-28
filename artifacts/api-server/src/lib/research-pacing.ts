/** Application defaults, not court-approved rates. No access or quota changes. */
export const protectedMinimumSpacingMs = 60_000;
export const pacingJitterRangeMs = 30_000;

export function pacingConfig(env: Record<string, string | undefined>) {
  const value = (key: string, fallback: number, minimum = 250) => {
    const raw = env[key];
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < minimum || n > 3_600_000)
      throw new Error(`Invalid bounded pacing policy: ${key}`);
    return n;
  };
  const externalMinimumMs = value("UJS_DOCUMENTED_MIN_SPACING_MS", 0, 0);
  const shared = env.UJS_SPACING_MS === undefined ? 0 : value("UJS_SPACING_MS", 1000);
  return {
    navigationMs: Math.max(protectedMinimumSpacingMs, shared, externalMinimumMs, value("UJS_NAVIGATION_SPACING_MS", 1000)),
    assetMs: Math.max(protectedMinimumSpacingMs, shared, externalMinimumMs, value("UJS_ASSET_SPACING_MS", 250)),
    searchMs: Math.max(protectedMinimumSpacingMs, shared, externalMinimumMs, value("UJS_SEARCH_SPACING_MS", 2000)),
    documentMs: Math.max(protectedMinimumSpacingMs, shared, externalMinimumMs, value("UJS_DOCUMENT_SPACING_MS", 3000)),
  };
}
export const researchPacing = pacingConfig(process.env);

export function requestSpacing(path: unknown, method: unknown) {
  return String(path).startsWith("/Report/") ? researchPacing.documentMs
    : String(path).startsWith("/resource/") ? researchPacing.assetMs
    : method === "POST" ? researchPacing.searchMs : researchPacing.navigationMs;
}

export function randomizedRequestSpacing(path: unknown, method: unknown, jitterMs: number) {
  if (!Number.isSafeInteger(jitterMs) || jitterMs < 0 || jitterMs > pacingJitterRangeMs)
    throw new Error("Request pacing jitter is outside the protected range.");
  return requestSpacing(path, method) + jitterMs;
}

export function effectiveAdaptiveSpacing(source: {
  adaptiveSpacingMs: number; throttleCount?: number; slowResponseStreak?: number; latencyWarning?: string | null;
}, base: number) {
  // The old 60s schema default is not observed backoff. Actual deterioration
  // and throttling retain their adaptive delay, regardless of new defaults.
  return source.throttleCount || source.slowResponseStreak || source.latencyWarning
    ? Math.max(base, source.adaptiveSpacingMs) : base;
}
