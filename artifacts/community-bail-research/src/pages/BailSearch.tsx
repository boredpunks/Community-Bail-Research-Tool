import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  exportBailSearch,
  getGetBailSearchStatusQueryKey,
  getListBailSearchesQueryKey,
  useGetBailSearchReadiness,
  useGetBailSearchStatus,
  useListBailSearches,
  useResumeBailSearch,
  useStartBailSearch,
  type BailSearch,
  type BailSearchResult,
} from '@workspace/api-client-react';
import { AlertTriangle, ArrowDownToLine, Clock3, FileSearch, Info, RefreshCw } from 'lucide-react';
import { Shell, PageHead } from '@/components/shell';
import { errMsg, formatInstant } from '@/lib/money';

function readSearchParam() {
  return new URLSearchParams(window.location.search).get('searchId') ?? '';
}

function writeSearchParam(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('searchId', id);
  else url.searchParams.delete('searchId');
  window.history.replaceState(null, '', url.toString());
}

function money(amount: number | null) {
  return amount == null ? 'Not recorded' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(amount);
}

function date(value: string | null) {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(parsed);
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bail-search-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ResultCard({ row }: { row: BailSearchResult }) {
  const isMatch = row.qualifies && row.bail_amount != null && !row.ambiguous;
  const kind = row.ambiguous ? 'Ambiguous decision'
    : row.qualifies && row.bail_amount != null ? 'Qualifying monetary record'
      : row.classification.replaceAll('_', ' ').toLowerCase();
  return (
    <article className={`bail-result ${isMatch ? 'bail-result-match' : ''}`} data-testid={`result-${row.id}`}>
      <div className="bail-result-top">
        <div className="min-w-0">
          <p className="mono bail-docket break-all">{row.docket_number}</p>
          <p className="hint">{row.office || 'Office not recorded'}</p>
        </div>
        <span className={`tag ${isMatch ? 'text-primary' : 'text-muted-foreground'}`}>{kind}</span>
      </div>
      <dl className="bail-result-facts">
        <div><dt>Hearing</dt><dd>{date(row.hearing_date)}</dd></div>
        <div><dt>Decision</dt><dd>{date(row.decision_date)}</dd></div>
        <div><dt>Recorded bail set</dt><dd className="mono font-semibold">{money(row.bail_amount)}</dd></div>
        <div><dt>Percentage</dt><dd>{row.percentage == null ? 'Not recorded' : `${row.percentage}%`}</dd></div>
      </dl>
      <p className="hint bail-classification">Classification: {row.classification.replaceAll('_', ' ')}</p>
      {row.ambiguous ? (
        <p className="bail-ambiguity" title="The latest decision could not be confidently identified from available evidence.">
          <Info size={16} aria-hidden="true" /> Latest decision is ambiguous; do not treat this amount as operative.
        </p>
      ) : null}
      {row.error ? <p className="errbox mt-3">{row.error}</p> : null}
      <div className="bail-evidence">
        <p className="mono text-xs font-semibold uppercase tracking-wide">
          Evidence{row.evidence_page != null ? ` · page ${row.evidence_page}` : ''}
        </p>
        <blockquote>{row.evidence_quote || 'No evidence quote was captured.'}</blockquote>
        <p className="hint">Acquisition: {row.evidence_acquisition || 'Not recorded'}</p>
      </div>
    </article>
  );
}

function ResultSection({ title, rows, detail }: { title: string; rows: BailSearchResult[]; detail: string }) {
  if (!rows.length) return null;
  return (
    <section className="mt-7" aria-label={title}>
      <div className="bail-section-heading">
        <h3 className="mono text-lg font-bold">{title}</h3>
        <span className="tag">{rows.length} {rows.length === 1 ? 'record' : 'records'}</span>
      </div>
      <p className="hint mb-3">{detail}</p>
      <div className="grid gap-3">{rows.map((row) => <ResultCard key={row.id} row={row} />)}</div>
    </section>
  );
}

export default function BailSearch() {
  const queryClient = useQueryClient();
  const readiness = useGetBailSearchReadiness();
  const searches = useListBailSearches({ query: { queryKey: getListBailSearchesQueryKey() } });
  const [searchId, setSearchId] = useState(readSearchParam);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxBail, setMaxBail] = useState('2000');
  const [source, setSource] = useState<'live' | 'saved'>('live');
  const [formError, setFormError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const selectedRunStarted = useRef<{ id: string; at: number } | null>(null);
  const lastSeenStatus = useRef<{ id: string; status: string } | null>(null);
  const started = useStartBailSearch();
  const resume = useResumeBailSearch();

  useEffect(() => {
    const handlePopState = () => setSearchId(readSearchParam());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!searchId && searches.data?.length) {
      const latest = searches.data[0].searchId;
      setSearchId(latest);
      writeSearchParam(latest);
    }
  }, [searchId, searches.data]);

  const statusQuery = useGetBailSearchStatus(searchId, {
    query: {
      queryKey: getGetBailSearchStatusQueryKey(searchId),
      enabled: !!searchId,
      refetchInterval: (query) => {
        const run = query.state.data as BailSearch | undefined;
        if (run?.status !== 'running') return false;
        if (selectedRunStarted.current?.id !== searchId) {
          selectedRunStarted.current = { id: searchId, at: Date.now() };
        }
        return Date.now() - selectedRunStarted.current.at < 5 * 60 * 1000 ? 4000 : false;
      },
    },
  });
  const run = statusQuery.data as BailSearch | undefined;

  useEffect(() => {
    if (!run) return;
    const previous = lastSeenStatus.current;
    if (previous?.id === run.searchId && previous.status !== run.status) {
      queryClient.invalidateQueries({ queryKey: getListBailSearchesQueryKey() });
    }
    lastSeenStatus.current = { id: run.searchId, status: run.status };
  }, [run?.searchId, run?.status, queryClient]);

  useEffect(() => {
    if (!searchId || (run?.status !== 'running' && !(run?.status === 'paused' && run.resumeAvailableAt))) return;
    if (run.status === 'running' && selectedRunStarted.current?.id !== searchId) {
      selectedRunStarted.current = { id: searchId, at: Date.now() };
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [searchId, run?.status, run?.resumeAvailableAt]);

  useEffect(() => {
    if (run?.status !== 'running') selectedRunStarted.current = null;
  }, [run?.status, searchId]);

  const stalled = !!run && run.status === 'running' && selectedRunStarted.current?.id === searchId
    && clock - selectedRunStarted.current.at >= 5 * 60 * 1000;
  const resumeAt = run?.resumeAvailableAt ? Date.parse(run.resumeAvailableAt) : null;
  const resumeWaiting = resumeAt != null && Number.isFinite(resumeAt) && resumeAt > clock;
  const canResume = !!run?.resumeToken && !resumeWaiting;
  const results = run?.results ?? [];
  const qualifying = useMemo(() => results.filter((row) => row.qualifies && row.bail_amount != null && !row.ambiguous), [results]);
  const other = useMemo(() => results.filter((row) => !qualifying.includes(row)), [results, qualifying]);

  function selectSearch(id: string) {
    setSearchId(id);
    writeSearchParam(id);
    selectedRunStarted.current = null;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const amount = maxBail.trim() ? Number(maxBail) : NaN;
    if (!startDate || !endDate) { setFormError('Choose both hearing dates.'); return; }
    if (endDate < startDate) { setFormError('The end hearing date must be on or after the start date.'); return; }
    if (!maxBail.trim() || !Number.isFinite(amount) || amount < 0 || amount > 20_000_000) {
      setFormError('Enter a maximum bail set from $0 to $20,000,000.'); return;
    }
    started.mutate({ data: { startDate, endDate, maxBail: amount, source } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetBailSearchStatusQueryKey(result.searchId), result);
        queryClient.invalidateQueries({ queryKey: getListBailSearchesQueryKey() });
        selectSearch(result.searchId);
        setFormError('');
      },
      onError: (error) => setFormError(`Search could not be started: ${errMsg(error)}`),
    });
  }

  function resumeRun() {
    if (!run?.resumeToken || !canResume) return;
    resume.mutate({ searchId: run.searchId, data: { resumeToken: run.resumeToken } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetBailSearchStatusQueryKey(result.searchId), result);
        queryClient.invalidateQueries({ queryKey: getListBailSearchesQueryKey() });
        selectedRunStarted.current = { id: result.searchId, at: Date.now() };
      },
    });
  }

  async function exportRun() {
    if (!searchId) return;
    setExportError('');
    setExporting(true);
    try {
      const csv = await exportBailSearch(searchId);
      downloadCsv(csv);
    } catch (error) {
      setExportError(`CSV export failed: ${errMsg(error)}`);
    } finally {
      setExporting(false);
    }
  }

  function retryStatus() {
    selectedRunStarted.current = { id: searchId, at: Date.now() };
    setClock(Date.now());
    statusQuery.refetch();
  }

  return (
    <Shell>
      <PageHead label="Volunteer search" title="Search bail evidence">
        Search hearing dates, inspect bail decisions, and export source-backed results. Partial searches retain their evidence.
      </PageHead>

      <div className="bail-search-layout">
        <div className="space-y-5">
          <section className="panel bail-source-panel" aria-labelledby="source-heading" data-testid="section-source-mode">
            <div className="flex items-start gap-3">
              <div className="bail-source-mark" aria-hidden="true"><FileSearch size={21} /></div>
              <div>
                <p className="bracket">Source mode</p>
                <h2 id="source-heading" className="mono text-xl font-bold">Choose your source</h2>
              </div>
            </div>
            <label className="block mt-3"><span className="lbl">Search source</span><select className="field" value={source} onChange={event => setSource(event.target.value as 'live' | 'saved')}>
              <option value="live">Live calendar search</option>
              <option value="saved">Saved workspace evidence — no new requests</option>
            </select></label>
            <p className="hint mt-3">{source === 'live'
              ? 'Bail Hearing · all supported offices · any room. Today or later, at most seven days. Source restrictions may pause collection; no automatic retries.'
              : 'Search existing calendar records and locally available evidence. This is not live court coverage.'}</p>
            {readiness.isLoading ? <div className="skel mt-3 h-5" aria-label="Loading source status" /> : null}
            {source === 'live' && readiness.data && !readiness.data.liveAvailable ? <p className="notice mt-3" role="status">{readiness.data.reason}</p> : null}
            {readiness.isError ? (
              <div className="hint mt-3" role="status">Readiness details are temporarily unavailable. Saved-evidence search remains explicitly non-live.</div>
            ) : readiness.data ? (
              <details className="mt-3">
                <summary className="cursor-pointer mono font-semibold text-primary">Source readiness details</summary>
                <p className="hint mt-2">{readiness.data.reason}</p>
                {readiness.data.evidence ? <p className="hint mt-1">{readiness.data.evidence}</p> : null}
                <p className="hint mt-1">Scope: {readiness.data.scope}. Access scope: {readiness.data.authScope}.</p>
              </details>
            ) : null}
          </section>

          <form className="panel space-y-4" onSubmit={submit} noValidate data-testid="form-bail-search">
            <div>
              <p className="bracket">Search criteria</p>
              <h2 className="mono text-xl font-bold">Set a hearing window</h2>
            </div>
            <p className="hint">Dates refer to hearing dates. Maximum bail is the recorded bail set ceiling, not an estimated release cost or deposit.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="lbl">Hearing date from</span>
                <input className="field" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} data-testid="input-search-start-date" />
              </label>
              <label className="block">
                <span className="lbl">Hearing date through</span>
                <input className="field" type="date" required value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} data-testid="input-search-end-date" />
              </label>
            </div>
            <label className="block max-w-sm">
              <span className="lbl">Maximum bail set (USD)</span>
              <div className="relative">
                <span className="bail-dollar-prefix" aria-hidden="true">$</span>
                <input className="field bail-dollar-input" type="number" inputMode="decimal" min="0" max="20000000" step="0.01" required value={maxBail} onChange={(event) => setMaxBail(event.target.value)} placeholder="e.g. 5,000" data-testid="input-max-bail" />
              </div>
              <span className="hint text-sm">Records at or below this recorded amount may qualify.</span>
            </label>
            {formError ? <p className="errbox" role="alert" data-testid="error-search-form">{formError}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={started.isPending || (source === 'live' && !readiness.data?.liveAvailable)} data-testid="button-start-bail-search">
              {started.isPending ? 'Starting search…' : 'Search bail'}
            </button>
            {started.isPending ? <p className="hint" role="status">Saving your search criteria…</p> : null}
          </form>

          <section className="panel" aria-labelledby="history-heading" data-testid="section-search-history">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="bracket">Private to this session</p>
                <h2 id="history-heading" className="mono text-xl font-bold">Recent searches</h2>
              </div>
              <p className="hint max-w-sm">A shared password does not create individual accounts. Locking the workspace or session expiry ends access to these searches.</p>
            </div>
            {searches.isLoading ? <div className="mt-4 space-y-2" aria-label="Loading recent searches"><div className="skel h-5" /><div className="skel h-5 w-4/5" /></div> : null}
            {searches.isError ? (
              <div className="errbox mt-4" role="alert">Search history could not be loaded. <button className="btn ml-2" type="button" onClick={() => searches.refetch()} data-testid="button-retry-search-list">Retry</button></div>
            ) : null}
            {searches.data?.length === 0 ? (
              <div className="bail-empty mt-4">
                <Clock3 size={22} aria-hidden="true" />
                <div><strong>No searches yet.</strong><p className="hint">Choose a hearing window to start one. Only server-returned searches appear here.</p></div>
              </div>
            ) : null}
            {searches.data?.length ? (
              <ul className="bail-history-list mt-4">
                {searches.data.map((item) => (
                  <li key={item.searchId}>
                    <button type="button" className={`bail-history-item ${searchId === item.searchId ? 'is-selected' : ''}`} onClick={() => selectSearch(item.searchId)} aria-current={searchId === item.searchId ? 'true' : undefined} data-testid={`button-select-search-${item.searchId}`}>
                      <span className="bail-history-date">{date(item.criteria.startDate)} – {date(item.criteria.endDate)}</span>
                      <span className="bail-history-meta">{item.status} · {item.progress.completed}/{item.progress.total} complete · max {money(item.criteria.maxBail)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <section className="bail-results-panel" aria-labelledby="results-heading" data-testid="section-search-results">
          <div className="panel bail-results-head">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="bracket">Evidence results</p>
                <h2 id="results-heading" className="mono text-xl font-bold">Search record</h2>
              </div>
              {run ? <span className={`tag bail-status-${run.status}`}>{run.status}</span> : null}
            </div>
            {!searchId ? <p className="hint mt-3">Start a search or select one from this session’s history.</p> : null}
            {searchId && statusQuery.isLoading ? <div className="mt-4 space-y-2" role="status" aria-label="Loading search record"><div className="skel h-6" /><div className="skel h-20" /></div> : null}
            {searchId && statusQuery.isError ? (
              <div className="errbox mt-4" role="alert">
                Search status is unavailable. It may belong to an expired or locked session. {errMsg(statusQuery.error)}
                <button className="btn mt-3" type="button" onClick={retryStatus} data-testid="button-retry-search-status">Reload status</button>
              </div>
            ) : null}
            {run ? (
              <>
                <p className="hint mt-3">Hearing dates {date(run.criteria.startDate)} through {date(run.criteria.endDate)} · maximum recorded bail {money(run.criteria.maxBail)} · {run.criteria.source} evidence.</p>
                {run.sourceNotice ? <p className="bail-source-notice mt-3">{run.sourceNotice}</p> : null}
                {run.status === 'running' ? (
                  <div className="bail-progress mt-4" role="status" data-testid="status-search-progress">
                    <div className="flex justify-between gap-3"><strong>{run.criteria.source === 'live' ? 'Searching source evidence' : 'Searching existing evidence'}</strong><span className="mono">{run.progress.completed}/{run.progress.total}</span></div>
                    <div className="bail-progress-track" aria-label={`${run.progress.completed} of ${run.progress.total} evidence items processed`}><span style={{ width: `${run.progress.total ? Math.min(100, run.progress.completed / run.progress.total * 100) : 0}%` }} /></div>
                    <p className="hint">{run.progress.pending} pending. {run.criteria.source === 'saved' ? 'No court requests are being made.' : 'Source requests follow shared pacing and access safeguards.'}</p>
                    {stalled ? <div className="notice mt-3"><strong>Progress has not finished.</strong> Automatic checks stopped after five minutes to avoid polling indefinitely. Reload status to check once more.</div> : null}
                  </div>
                ) : null}
                {run.status === 'paused' ? (
                  <div className="bail-paused mt-4" role="status" data-testid="status-search-paused">
                    <p className="font-semibold">Paused: {run.progress.completed}/{run.progress.total} complete · {run.progress.pending} pending.</p>
                    {run.reason ? <p className="hint mt-1">{run.reason}</p> : null}
                    {resumeWaiting && resumeAt ? <p className="hint mt-1">Resume available {formatInstant(run.resumeAvailableAt!)}.</p> : null}
                    {run.resumeToken ? <button type="button" className="btn mt-3" onClick={resumeRun} disabled={!canResume || resume.isPending} data-testid="button-resume-search">
                      {resume.isPending ? 'Resuming…' : resumeWaiting ? 'Resume temporarily unavailable' : 'Resume search'}
                    </button> : <p className="hint mt-2">This search cannot be resumed because no resume token is available.</p>}
                    {resume.isError ? <p className="errbox mt-3" role="alert">Resume failed: {errMsg(resume.error)}</p> : null}
                  </div>
                ) : null}
                {run.status === 'complete' ? <p className="bail-complete mt-4" role="status">Search complete for the reported scope. {run.sourceNotice}</p> : null}
                {run.incomplete ? <div className="notice mt-3"><strong>Incomplete coverage.</strong> Treat the records below as partial; they do not represent all hearings or decisions in the date window.</div> : null}
                {run.reason && run.status !== 'paused' ? <p className="hint mt-2">{run.reason}</p> : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" onClick={exportRun} disabled={exporting} data-testid="button-export-search">
                    <ArrowDownToLine size={17} aria-hidden="true" className="mr-2" />{exporting ? 'Preparing CSV…' : 'Export server CSV'}
                  </button>
                  {exportError ? <span className="hint text-destructive" role="alert">{exportError}</span> : null}
                </div>
                {run.updatedAt ? <p className="hint mt-2 text-xs">Updated {formatInstant(run.updatedAt)}.</p> : null}
              </>
            ) : null}
          </div>

          {run && !statusQuery.isError ? (
            <div className="panel mt-4">
              <div className="bail-results-summary">
                <div><span className="bail-count">{qualifying.length}</span><span className="hint"> qualifying monetary records</span></div>
                <p className="hint">Qualifying means a recorded monetary amount at or below the maximum, with no ambiguous decision flag. It is not a release-cost estimate.</p>
              </div>
              {!results.length && run.status !== 'running' ? (
                <div className="bail-empty mt-4">
                  <AlertTriangle size={22} aria-hidden="true" />
                  <div><strong>No result records returned.</strong><p className="hint">An empty result does not establish that no bail was set or that no records exist.</p></div>
                </div>
              ) : null}
              {qualifying.length ? <ResultSection title="Qualifying monetary records" rows={qualifying} detail="These records contain a qualifying amount. Review the source quote and dates; this does not establish current custody, amount due, or release eligibility." /> : null}
              <ResultSection title="Other, unknown, or nonmatching records" rows={other} detail="Amounts in this section are not qualifying matches. They may be above the maximum, unknown, unsecured, denied, nonmonetary, or ambiguous." />
              {run.status === 'running' && !results.length ? <p className="hint mt-5">No results have been reported yet. Evidence may still be processing.</p> : null}
            </div>
          ) : null}
          {stalled ? <div className="bail-stalled-foot"><RefreshCw size={16} aria-hidden="true" /> Monitoring is paused. <button type="button" className="underline" onClick={retryStatus}>Reload status</button></div> : null}
        </section>
      </div>
    </Shell>
  );
}
