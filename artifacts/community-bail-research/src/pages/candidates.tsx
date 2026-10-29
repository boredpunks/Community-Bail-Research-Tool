import { getListBailSearchCandidatesQueryKey, useListBailSearchCandidates } from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { errMsg } from '@/lib/money';
import { money, safeSourceUrl } from '@/lib/latest-search';

export default function Candidates() {
  const q = useListBailSearchCandidates({ query: { queryKey: getListBailSearchCandidatesQueryKey() } });
  const rows = q.data ?? [];
  return (
    <Shell>
      <PageHead label="Candidates" title="Marked candidates">Shared with the workspace.</PageHead>
      {q.isLoading ? <div className="space-y-2"><div className="skel h-6" /><div className="skel h-6" /></div> : null}
      {q.isError ? <p className="errbox" role="alert">{errMsg(q.error)} <button type="button" className="btn ml-2" onClick={() => q.refetch()} data-testid="button-retry-candidates">Retry</button></p> : null}
      {q.data && rows.length === 0 ? <p className="hint">No candidates yet.</p> : null}
      {rows.length ? (
        <div className="bail-compare-scroll">
          <table className="bail-compare-table" style={{ minWidth: 0 }} data-testid="table-candidates">
            <thead><tr><th>Docket</th><th>Bail</th><th>Citation</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const url = safeSourceUrl(row.source_url);
                return (
                  <tr key={row.id} data-testid={`row-candidate-${row.id}`}>
                    <th className="mono break-all">{row.docket_number}</th>
                    <td className="mono">{money(row.bail_amount)}</td>
                    <td>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="navlink">PDF{row.evidence_page != null ? `, p. ${row.evidence_page}` : ''}</a> : <span className="hint">PDF link unavailable</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Shell>
  );
}
