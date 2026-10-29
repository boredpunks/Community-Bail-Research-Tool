import type { BailDecisionEvidence } from "@workspace/db";

/** Printed row position alone does not establish chronology within a day. */
export function selectBailDecision(entries: BailDecisionEvidence[]) {
  const history = entries.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map(row => ({ ...row })).sort((a, b) => b.date.localeCompare(a.date));
  if (!history.length) return { classification: "unknown", amount: null, percentage: null,
    decisionDate: null, ambiguous: false, page: null, quote: "", history };
  const latest = history.filter(row => row.date === history[0]!.date);
  const unique = new Map(latest.map(row => [
    JSON.stringify([row.classification, row.amount, row.percentage]), row,
  ]));
  const ambiguous = unique.size > 1;
  const decision = latest[0]!;
  return {
    classification: ambiguous ? "ambiguous" : decision.classification,
    amount: ambiguous ? null : decision.amount,
    percentage: ambiguous ? null : decision.percentage,
    decisionDate: decision.date, ambiguous,
    page: ambiguous ? null : decision.page,
    quote: ambiguous ? latest.map(row => row.quote).join("\n---\n").slice(0, 4000) : decision.quote,
    history,
  };
}

export function qualifiesMonetary(decision: ReturnType<typeof selectBailDecision>, maximum: number) {
  return !decision.ambiguous && decision.classification === "monetary"
    && decision.amount !== null && decision.amount > 0 && decision.amount <= maximum;
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formulas in source-derived docket, office and quotation fields.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
