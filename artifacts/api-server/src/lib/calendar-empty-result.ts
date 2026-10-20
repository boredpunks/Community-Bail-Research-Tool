import { isExplicitEmptyCalendarLayout } from "./calendar-layout";
import { validCalendarResponseDiagnostic } from "./calendar-response-diagnostics";

/** Accept only the expected ordered state transition for a validated empty search. */
export function validatedEmptyResultStateMessage(stateMessages: unknown): string | null {
  if (!Array.isArray(stateMessages) || stateMessages.length !== 2) return null;
  const [formReady, terminal] = stateMessages;
  if (typeof formReady !== "string" || !formReady.startsWith("FORM_READY;")
    || typeof terminal !== "string" || !terminal.startsWith("EMPTY_RESULTS_VALIDATED;")) return null;
  return terminal;
}

/** Cross-check the parser's empty marker against the retained layout and result diagnostics. */
export function isValidatedExplicitEmptyResult(
  layout: unknown, diagnostic: unknown, stateMessage: unknown,
) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)
    || !diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)
    || typeof stateMessage !== "string" || !stateMessage.startsWith("EMPTY_RESULTS_VALIDATED;")) return false;
  const layoutRecord = layout as Record<string, unknown>;
  const diagnosticRecord = diagnostic as Record<string, unknown>;
  if (!isExplicitEmptyCalendarLayout(layoutRecord)
    || !validCalendarResponseDiagnostic(diagnosticRecord)
    || diagnosticRecord.documentEligibility !== "VALIDATED_EMPTY") return false;
  const result = diagnosticRecord.resultValidation as Record<string, unknown>;
  const structure = diagnosticRecord.structure as Record<string, unknown>;
  return structure.resultTableCount === 1 && structure.headerCellCount === 19
    && structure.dataRowCount === 1 && structure.documentLinkCount === 0
    && structure.expectedHeaders === true && structure.countsCapped === false
    && result.outcome === "VALIDATED_EMPTY"
    && result.explicitEmptyResult === "SOURCE_STATUS_MARKER";
}
