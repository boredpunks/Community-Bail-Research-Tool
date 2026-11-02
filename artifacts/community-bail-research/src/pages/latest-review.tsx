import type { BailSearchResult } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Shell, PageHead } from '@/components/shell';
import { CandidateAction } from '@/components/candidate-action';
import { errMsg } from '@/lib/money';
import { isReviewable, money, safeSourceUrl, useLatestSearch } from '@/lib/latest-search';

function Citation({ row }: { row: BailSearchResult }) {
  const url = safeSourceUrl(row.source_url);
  const page = row.evidence_page != null ? `p. ${row.evidence_page}` : 'page not recorded';
  if (!url) return <span className="hint">PDF link unavailable</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="navlink" data-testid={`link-pdf-${row.id}`}>PDF, {page}</a>;
}

export default function LatestReview() {
  const { run, list, status } = useLatestSearch();
  const rows = (run?.results ?? []).filter(isReviewable);
  return (
    <Shell>
      <PageHead label="Review" title="Latest search matches">
        {run?.canManage
          ? 'Candidate saves the row to the shared workspace, visible to everyone with the password.'
          : 'Earlier searches are visible to everyone with the password; only their creating session can save or resume them.'}
      </PageHead>
      {list.isLoading ? <div className="space-y-2"><div className="skel h-6" /><div className="skel h-6" /></div> : null}
      {list.isError ? <p className="errbox" role="alert">Could not load. <button type="button" className="btn ml-2" onClick={() => list.refetch()}>Retry</button></p> : null}
      {status.isLoading ? <p className="hint" role="status">Loading latest results…</p> : null}
      {status.isError ? <p className="errbox" role="alert">Latest results could not be refreshed. <button type="button" className="btn" onClick={() => status.refetch()}>Retry</button></p> : null}
      {!list.isLoading && !run ? <p className="hint">No search yet. <Link href="/search" className="navlink">Search</Link></p> : null}
      {run && !status.isLoading && !status.isError && rows.length === 0 ? <p className="hint">{run.status === 'running' ? 'Searching. Matches appear here as they arrive.' : run.incomplete ? 'No matches yet. The latest search is incomplete.' : 'No matches in the latest search.'}</p> : null}
      {run && rows.length ? (
        <div className="bail-compare-scroll">
          <table className="bail-compare-table" style={{ minWidth: 0 }} data-testid="table-review">
            <thead><tr><th>Docket</th><th>Bail</th><th>Citation</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`row-review-${row.id}`}>
                  <th className="mono break-all">{row.docket_number}</th>
                  <td className="mono">{money(row.bail_amount)}</td>
                  <td><Citation row={row} /></td>
                  <td><CandidateAction row={row} searchId={run.searchId} canManage={run.canManage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Shell>
  );
}
