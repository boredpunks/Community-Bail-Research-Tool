export type Recovery = {
  action: "none" | "resume" | "wait" | "evidence_needed" | "new_search" | "source_blocked";
  message: string;
  availableAt: string | null;
};
export function chooseRecovery(input: {
  paused: boolean; saved: boolean; missingEvidence: boolean; expired: boolean;
  noJob: boolean; sourceBlocked: boolean; cooldown: Date | null; now?: Date;
}): Recovery {
  const now = input.now ?? new Date();
  if (!input.paused) return { action: "none", message: "", availableAt: null };
  if (input.saved && input.missingEvidence) return {
    action: "evidence_needed", message: "Some documents are unavailable or could not be checked. Your checked results are saved. Use Advanced court search or enter verified evidence, then start a new collected-evidence search.", availableAt: null,
  };
  if (!input.saved && (input.expired || input.noJob)) return {
    action: "new_search", message: "This search cannot continue within its original dates or request budget. Your results are saved. Start a new search of collected evidence.", availableAt: null,
  };
  if (!input.saved && input.sourceBlocked) return {
    action: "source_blocked", message: "Court access is blocked or requires verification. Repeated retries will not resolve this. Your results are saved; use collected evidence or ask the workspace coordinator.", availableAt: null,
  };
  if (input.cooldown && input.cooldown > now) return {
    action: "wait", message: "Collection is temporarily paused. Your results are saved. Continue after the displayed time.", availableAt: input.cooldown.toISOString(),
  };
  return { action: "resume", message: "Your results are saved. Continue checking the remaining evidence.", availableAt: null };
}
