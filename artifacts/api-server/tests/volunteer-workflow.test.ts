import test from "node:test";
import assert from "node:assert/strict";
import { chooseRecovery } from "../src/services/bail-search-recovery";
import { selectBailDecision, qualifiesMonetary, csvCell } from "../src/lib/bail-decision";

const base = { paused: true, saved: true, missingEvidence: false, expired: false,
  noJob: false, sourceBlocked: false, cooldown: null, now: new Date("2026-10-29T12:00:00Z") };
test("unknown totals and running states never invite resume", () => {
  assert.equal(chooseRecovery({ ...base, paused: false }).action, "none");
});
test("missing local evidence needs evidence, not a futile retry", () => {
  assert.equal(chooseRecovery({ ...base, missingEvidence: true }).action, "evidence_needed");
});
test("interrupted local processing can resume explicitly", () => {
  assert.equal(chooseRecovery(base).action, "resume");
});
test("quota wait exposes a concrete time then becomes resumable", () => {
  const cooldown = new Date("2026-10-29T13:00:00Z");
  assert.deepEqual(chooseRecovery({ ...base, saved: false, cooldown }), {
    action: "wait", availableAt: cooldown.toISOString(),
    message: "Collection is temporarily paused. Your results are saved. Continue after the displayed time.",
  });
  assert.equal(chooseRecovery({ ...base, saved: false, cooldown, now: new Date("2026-10-29T14:00:00Z") }).action, "resume");
});
test("access failures never invite a retry, even with a future cooldown", () => {
  assert.equal(chooseRecovery({ ...base, saved: false, sourceBlocked: true,
    cooldown: new Date("2026-10-29T13:00:00Z") }).action, "source_blocked");
});
test("missing job, expired scope and exhausted budget require a new search", () => {
  assert.equal(chooseRecovery({ ...base, saved: false, noJob: true }).action, "new_search");
  assert.equal(chooseRecovery({ ...base, saved: false, expired: true }).action, "new_search");
});
const monetary = { date: "2026-10-28", classification: "monetary", amount: 1000, percentage: null, page: 1, quote: "Test fixture — bail set" };
test("same-day conflicts remain ambiguous and do not pass the amount filter", () => {
  const decision = selectBailDecision([monetary, { ...monetary, amount: 2000 }]);
  assert.equal(decision.ambiguous, true);
  assert.equal(decision.amount, null);
  assert.equal(qualifiesMonetary(decision, 2000), false);
});
test("later denied or nonmonetary decision supersedes monetary", () => {
  for (const classification of ["denied", "nonmonetary"]) {
    const decision = selectBailDecision([monetary, { ...monetary, date: "2026-10-29", amount: null, classification }]);
    assert.equal(decision.classification, classification);
    assert.equal(qualifiesMonetary(decision, 2000), false);
  }
});
test("empty evidence is unknown, never zero bail", () => {
  assert.equal(selectBailDecision([]).amount, null);
  assert.equal(selectBailDecision([]).classification, "unknown");
});
test("CSV escapes quotes and spreadsheet formulas", () => {
  assert.equal(csvCell('=SUM(1,2)'), '"\'=SUM(1,2)"');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});
