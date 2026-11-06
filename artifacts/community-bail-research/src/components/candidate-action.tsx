import { useSaveBailSearchResult, type BailSearchResult } from '@workspace/api-client-react';
import { errMsg } from '@/lib/money';
import { useAfterCandidateSave } from '@/lib/latest-search';
import { CANDIDATE_SAVED_LABEL, CANDIDATE_SAVE_LABEL, CANDIDATE_SAVE_TITLE } from '@/lib/workflow-copy';

type CandidateActionProps = {
  row: BailSearchResult;
  searchId: string;
  canManage: boolean;
  buttonLabel?: string;
  savedLabel?: string;
  testId?: string;
  compact?: boolean;
  showDisabledButton?: boolean;
  blue?: boolean;
};

export function CandidateAction({
  row,
  searchId,
  canManage,
  buttonLabel = CANDIDATE_SAVE_LABEL,
  savedLabel = CANDIDATE_SAVED_LABEL,
  testId = `button-candidate-${row.id}`,
  compact = false,
  showDisabledButton = false,
  blue = false,
}: CandidateActionProps) {
  const after = useAfterCandidateSave(searchId);
  const save = useSaveBailSearchResult({ mutation: { onSuccess: after } });
  const disabledReason = !canManage
    ? 'Only the session that created this search can save its results.'
    : row.save_available !== true
      ? row.save_reason || 'This result is not ready to save for review.'
      : null;

  if (row.saved_record_id && blue && showDisabledButton) {
    return (
      <button
        type="button"
        className={`btn btn-candidate-blue${compact ? ' btn-compact' : ''}`}
        disabled
        title="Already in the shared Candidates list"
        data-testid={testId}
      >
        {savedLabel}
      </button>
    );
  }
  if (row.saved_record_id) {
    return <span className="tag text-primary" data-testid={`status-candidate-${row.id}`}>{savedLabel}</span>;
  }
  if (!showDisabledButton && !canManage) {
    return <span className="hint" data-testid={`text-readonly-result-${row.id}`}>View only · created by another session</span>;
  }
  if (!showDisabledButton && row.save_available !== true) {
    return <span className="hint" data-testid={`text-save-unavailable-${row.id}`}>Cannot save{row.save_reason ? `: ${row.save_reason}` : ''}</span>;
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        className={`btn ${blue ? 'btn-candidate-blue' : 'btn-primary'}${compact ? ' btn-compact' : ''}`}
        disabled={save.isPending || disabledReason !== null}
        title={disabledReason ?? CANDIDATE_SAVE_TITLE}
        onClick={() => save.mutate({ searchId, resultId: row.id, data: { shareWithWorkspace: true } })}
        data-testid={testId}
      >
        {save.isPending ? 'Saving…' : buttonLabel}
      </button>
      {disabledReason ? <p className="hint text-xs" data-testid={`text-save-unavailable-${row.id}`}>{disabledReason}</p> : null}
      {save.isError ? <p className="errbox mt-1" role="alert">{errMsg(save.error)}</p> : null}
    </div>
  );
}
