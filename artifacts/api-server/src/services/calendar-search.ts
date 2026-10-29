/**
 * Calendar admission is not calendar verification. Do not infer readiness from
 * document access, cached extraction, or a source-wide collection flag.
 * Update this reviewed evidence record only after a real scoped proof succeeds.
 */
export const calendarSearchReadiness = {
  calendarVerified: false,
  liveAvailable: false,
  evidence: null as string | null,
  reason: "Auto-discovery coming soon. Calendar search has not yet been verified; the previous authorized test date has passed.",
  scope: "Saved workspace calendar records and locally available source evidence only. No new court requests.",
  authScope: "signed-in session",
};
