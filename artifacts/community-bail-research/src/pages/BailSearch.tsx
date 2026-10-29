import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  exportBailSearch,
  getGetBailSearchStatusQueryKey,
  getListBailSearchesQueryKey,
  getListBailRecordsQueryKey,
  useGetBailSearchReadiness,
  useSaveBailSearchResult,
  useGetBailSearchStatus,
  useListBailSearches,
  useResumeBailSearch,
  useStartBailSearch,
  type BailSearch,
  type BailSearchResult,
} from '@workspace/api-client-react';
import { AlertTriangle, ArrowDownToLine, Clock3, ExternalLink, FileSearch, Info, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

function safeSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isMatch(row: BailSearchResult) {
  return row.qualifies && row.bail_amount != null && !row.ambiguous;
}

const GLOSSARY: [string, string][] = [
  ['Within your amount filter', 'A recorded monetary bail amount at or below your maximum, with no ambiguity flag. It does not mean eligible for release, in custody, or what release would cost.'],
  ['Ambiguous', 'The latest decision could not be confidently identified. Do not treat the amount as the order in effect.'],
  ['Above filter / other monetary', 'A recorded amount above your maximum, or a monetary type outside the filter.'],
  ['Nonmonetary, unsecured, denied', 'No monetary bail amount to compare against your filter.'],
  ['Unknown / evidence error', 'The document could not be read or did not contain a recognizable decision. Missing evidence is not evidence of no bail.'],
];

const STAGE_LABEL: Record<string, string> = {
  finding_hearings: 'Finding hearings',
  checking_documents: 'Checking documents',
  paused: 'Paused',
  complete: 'Complete',
};

function downloadCsv(csv: string, selection: 'all' | 'matches') {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bail-search-${selection}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SaveControl({ row, searchId }: { row: BailSearchResult; searchId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const save = useSaveBailSearchResult({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetBailSearchStatusQueryKey(searchId), (old: BailSearch | undefined) =>
          old ? { ...old, results: old.results.map((item) => item.id === updated.id ? { ...item, ...updated } : item) } : old);
        queryClient.invalidateQueries({ queryKey: getGetBailSearchStatusQueryKey(searchId) });
        queryClient.invalidateQueries({ queryKey: getListBailSearchesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBailRecordsQueryKey() });
        setOpen(false);
      },
    },
  });
  if (row.saved_record_id) {
    return (
      <div className="bail-save mt-3" data-testid={`status-saved-${row.id}`}>
        <p className="hint">Saved to the shared workspace{row.review_status ? ` · review status: ${row.review_status.toLowerCase()}` : ''}. Saving is not a source confirmation or order interpretation.</p>
        <div className="flex flex-wrap gap-3 mt-2">
          <Link href="/review" className="navlink" data-testid={`link-review-${row.id}`}>Open review queue</Link>
          <Link href="/candidates" className="navlink" data-testid={`link-saved-dockets-${row.id}`}>Saved dockets</Link>
        </div>
      </div>
    );
  }
  if (row.save_available !== true) {
    return <p className="hint mt-3" data-testid={`text-save-unavailable-${row.id}`}>Cannot be saved for review: {row.save_reason || 'the server did not report this result as saveable.'}</p>;
  }
  return (
    <div className="mt-3">
      <button type="button" className="btn" onClick={() => { save.reset(); setOpen(true); }} data-testid={`button-save-result-${row.id}`}>Save for review</button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!save.isPending) setOpen(next); }}>
        <AlertDialogContent className="border-primary bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="mono">Share this evidence with the workspace?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-foreground">
                <p className="mono break-all">{row.docket_number}</p>
                <p>Search results are private to this session. Saving copies this docket, its original evidence quote, source link and consultation time into the <strong>shared workspace</strong>, where everyone with the password can see it.</p>
                <p>It enters the review queue as pending. Saving does not confirm the source, does not mark any order operative, and does not imply release eligibility. Saving the same result again will not create a duplicate.</p>
                {save.isError ? <p className="errbox" role="alert">Save failed: {errMsg(save.error)}</p> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn" disabled={save.isPending} data-testid={`button-cancel-save-${row.id}`}>Keep private</AlertDialogCancel>
            <AlertDialogAction
              className="btn btn-primary"
              disabled={save.isPending}
              onClick={(event) => { event.preventDefault(); save.mutate({ searchId, resultId: row.id, data: { shareWithWorkspace: true } }); }}
              data-testid={`button-confirm-save-${row.id}`}
            >
              {save.isPending ? 'Saving…' : 'Save to shared workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {save.isError && !open ? <p className="errbox mt-2" role="alert">Save failed: {errMsg(save.error)}</p> : null}
    </div>
  );
}

function ResultCard({ row, searchId }: { row: BailSearchResult; searchId: string }) {
  const match = isMatch(row);
  const kind = row.ambiguous ? 'Ambiguous decision'
    : match ? 'Within your amount filter'
      : row.classification.replaceAll('_', ' ').toLowerCase();
  const sourceUrl = safeSourceUrl(row.source_url);
  return (
    <article className={`bail-result ${match ? 'bail-result-match' : ''}`} data-testid={`result-${row.id}`}>
      <div className="bail-result-top">
        <div className="min-w-0">
          <p className="mono bail-docket break-all">{row.docket_number}</p>
          <p className="hint">{row.office || 'Office not recorded'}</p>
        </div>
        <span className={`tag ${match ? 'text-primary' : 'text-muted-foreground'}`}>{kind}</span>
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
          Evidence{row.evidence_page != null ? ` · page ${row.evidence_page}` : ' · page not recorded'}
        </p>
        <blockquote>{row.evidence_quote || 'No evidence quote was captured.'}</blockquote>
        <p className="hint">Acquisition: {row.evidence_acquisition || 'Not recorded'}</p>
        <p className="hint">Source consulted: {row.source_retrieved_at ? formatInstant(row.source_retrieved_at) : 'Not recorded'}</p>
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="navlink inline-flex items-center gap-1 mt-2" data-testid={`link-source-${row.id}`}>
            Open source document <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : <p className="hint">Source document link unavailable.</p>}
      </div>
      <SaveControl row={row} searchId={searchId} />
    </article>
  );
}

function ResultSection({ title, rows, detail, searchId }: { title: string; rows: BailSearchResult[]; detail: string; searchId: string }) {
  if (!rows.length) return null;
  return (
    <section className="mt-7" aria-label={title}>
      <div className="bail-section-heading">
        <h3 className="mono text-lg font-bold">{title}</h3>
        <span className="tag">{rows.length} {rows.length === 1 ? 'record' : 'records'}</span>
      </div>
      <p className="hint mb-3">{detail}</p>
      <div className="grid gap-3">{rows.map((row) => <ResultCard key={row.id} row={row} searchId={searchId} />)}</div>
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
  const [formError, setFormError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState<'all' | 'matches' | null>(null);
  const [lastExport, setLastExport] = useState('');
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
    if (!searchId || (run?.status !== 'running' && !(run?.status === 'paused' && (run.resumeAvailableAt || run.recovery?.availableAt)))) return;
    if (run.status === 'running' && selectedRunStarted.current?.id !== searchId) {
      selectedRunStarted.current = { id: searchId, at: Date.now() };
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [searchId, run?.status, run?.resumeAvailableAt, run?.recovery?.availableAt]);

  useEffect(() => {
    if (run?.status !== 'running') selectedRunStarted.current = null;
  }, [run?.status, searchId]);

  const stalled = !!run && run.status === 'running' && selectedRunStarted.current?.id === searchId
    && clock - selectedRunStarted.current.at >= 5 * 60 * 1000;
  const resumeAt = run?.resumeAvailableAt ? Date.parse(run.resumeAvailableAt) : null;
  const resumeWaiting = resumeAt != null && Number.isFinite(resumeAt) && resumeAt > clock;
  const recovery = run?.recovery;
  const recoveryAt = recovery?.availableAt ? Date.parse(recovery.availableAt) : resumeAt;
  const recoveryWaiting = recoveryAt != null && Number.isFinite(recoveryAt) && recoveryAt > clock;
  const resumeEligible = !!run?.resumeToken && (recovery ? (recovery.action === 'resume' || recovery.action === 'wait') : true);
  const canResume = resumeEligible && !recoveryWaiting && !resumeWaiting;
  const stage = run?.stage ?? (run?.status === 'paused' ? 'paused' : run?.status === 'complete' ? 'complete' : undefined);
  const totalKnown = !!run && run.progress.total > 0 && stage !== 'finding_hearings';
  const results = run?.results ?? [];
  const qualifying = useMemo(() => results.filter(isMatch), [results]);
  const other = useMemo(() => results.filter((row) => !qualifying.includes(row)), [results, qualifying]);

  function selectSearch(id: string) {
    setSearchId(id);
    writeSearchParam(id);
    selectedRunStarted.current = null;
  }

  function newSearch() {
    setSearchId('');
    writeSearchParam('');
    selectedRunStarted.current = null;
    setStartDate('');
    setEndDate('');
    setMaxBail('2000');
    setFormError('');
    setExportError('');
    setLastExport('');
  }

  function editSearch() {
    if (!run) return;
    setStartDate(run.criteria.startDate);
    setEndDate(run.criteria.endDate);
    setMaxBail(String(run.criteria.maxBail));
    setFormError('');
    document.getElementById('bail-search-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    started.mutate({ data: { startDate, endDate, maxBail: amount, source: 'saved' } }, {
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
    if (!resumeEligible) return;
    resume.mutate({ searchId: run.searchId, data: { resumeToken: run.resumeToken } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetBailSearchStatusQueryKey(result.searchId), result);
        queryClient.invalidateQueries({ queryKey: getListBailSearchesQueryKey() });
        selectedRunStarted.current = { id: result.searchId, at: Date.now() };
      },
    });
  }

  async function exportRun(selection: 'all' | 'matches') {
    if (!searchId) return;
    setExportError('');
    setLastExport('');
    setExporting(selection);
    try {
      const csv = await exportBailSearch(searchId, { selection });
      downloadCsv(csv, selection);
      const count = selection === 'all' ? results.length : qualifying.length;
      setLastExport(`Downloaded ${selection === 'all' ? 'all records' : 'amount-filter matches only'} (${count} ${count === 1 ? 'row' : 'rows'}${run?.incomplete ? ', partial search' : ''}).`);
    } catch (error) {
      setExportError(`CSV export failed: ${errMsg(error)}`);
    } finally {
      setExporting(null);
    }
  }

  function retryStatus() {
    selectedRunStarted.current = { id: searchId, at: Date.now() };
    setClock(Date.now());
    statusQuery.refetch();
  }

  const collected = readiness.data?.collectedDockets;
  const collectedText = readiness.isLoading ? 'loading count' : typeof collected === 'number' && Number.isFinite(collected) ? collected.toLocaleString('en-US') : 'an unknown number of';
  const allLabel = `Download CSV — all records (${results.length})${run?.incomplete ? ' · partial' : ''}`;
  const matchLabel = `Download CSV — amount-filter matches (${qualifying.length})${run?.incomplete ? ' · partial' : ''}`;

  return (
    <Shell>
      <PageHead label="Volunteer search" title="Search bail evidence">
        Search collected dockets by hearing date, inspect bail decisions, and export source-backed results. Finding a bail amount never means a person is eligible for release.
      </PageHead>

      <div className="bail-search-layout">
        <div className="space-y-5">
          <section className="panel bail-source-panel" aria-labelledby="source-heading" data-testid="section-source-mode">
            <div className="flex items-start gap-3">
              <div className="bail-source-mark" aria-hidden="true"><FileSearch size={21} /></div>
              <div>
                <p className="bracket">Source</p>
                <h2 id="source-heading" className="mono text-xl font-bold">Collected evidence only</h2>
              </div>
            </div>
            <p className="notice mt-3" role="status" data-testid="text-collected-dockets">
              Live calendar discovery coming soon — currently searching {collectedText} collected dockets
            </p>
            <p className="hint mt-3">This search uses dockets already collected in the workspace. It makes no new court requests and is not live date-range coverage. A docket that is not collected will not appear. For experimental live collection, use <Link href="/discovery" className="underline" data-testid="link-advanced-search">Advanced court search</Link>.</p>
            {readiness.isError ? (
              <div className="hint mt-3" role="status">Source details are temporarily unavailable. <button type="button" className="underline" onClick={() => readiness.refetch()} data-testid="button-retry-readiness">Retry</button></div>
            ) : readiness.data ? (
              <details className="mt-3">
                <summary className="cursor-pointer mono font-semibold text-primary">Source details</summary>
                <p className="hint mt-2">{readiness.data.reason}</p>
                {readiness.data.evidence ? <p className="hint mt-1">{readiness.data.evidence}</p> : null}
                <p className="hint mt-1">Scope: {readiness.data.scope}. Access scope: {readiness.data.authScope}.</p>
                <p className="hint mt-1">Search results stay private to this session until you explicitly save one to the shared workspace.</p>
              </details>
            ) : null}
          </section>

          <form id="bail-search-form" className="panel space-y-4" onSubmit={submit} noValidate data-testid="form-bail-search">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="bracket">Search criteria</p>
                <h2 className="mono text-xl font-bold">Set a hearing window</h2>
              </div>
              <button type="button" className="btn" onClick={newSearch} data-testid="button-new-search">New search</button>
            </div>
            <p className="hint">Dates refer to hearing dates. Maximum bail is a filter on the recorded bail set, not an estimated release cost or deposit. Each run is saved separately; starting a new one never overwrites earlier results.</p>
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
              <span className="hint text-sm">Records at or below this recorded amount are shown as within your amount filter.</span>
            </label>
            {formError ? <p className="errbox" role="alert" data-testid="error-search-form">{formError}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={started.isPending} data-testid="button-start-bail-search">
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
                      <span className="bail-history-meta">{item.status}{item.progress.total > 0 && item.stage !== 'finding_hearings' ? ` · ${item.progress.completed}/${item.progress.total} checked` : ''} · max {money(item.criteria.maxBail)}</span>
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
              {run ? <span className={`tag bail-status-${run.status}`} data-testid="status-search">{stage ? STAGE_LABEL[stage] ?? run.status : run.status}</span> : null}
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
                <p className="hint mt-3">Hearing dates {date(run.criteria.startDate)} through {date(run.criteria.endDate)} · amount filter {money(run.criteria.maxBail)} · {run.criteria.source === 'saved' ? 'collected' : run.criteria.source} evidence.</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" className="btn" onClick={editSearch} data-testid="button-edit-search">Edit this search</button>
                  <button type="button" className="btn" onClick={newSearch} data-testid="button-new-search-results">New search</button>
                </div>
                {run.sourceNotice ? <p className="bail-source-notice mt-3">{run.sourceNotice}</p> : null}
                {run.status === 'running' ? (
                  <div className="bail-progress mt-4" role="status" data-testid="status-search-progress">
                    <div className="flex justify-between gap-3">
                      <strong>{stage === 'finding_hearings' ? 'Finding hearings' : stage === 'checking_documents' ? 'Checking documents' : 'Searching collected evidence'}</strong>
                      {totalKnown ? <span className="mono">{run.progress.completed}/{run.progress.total}</span> : null}
                    </div>
                    {totalKnown ? (
                      <div className="bail-progress-track" aria-label={`${run.progress.completed} of ${run.progress.total} documents checked`}><span style={{ width: `${Math.min(100, run.progress.completed / run.progress.total * 100)}%` }} /></div>
                    ) : <p className="hint">The number of hearings is not known yet.</p>}
                    {totalKnown ? <p className="hint">{run.progress.pending} pending. {run.criteria.source === 'saved' ? 'No court requests are being made.' : 'Source requests follow shared pacing and access safeguards.'}</p> : null}
                    {stalled ? <div className="notice mt-3"><strong>Progress has not finished.</strong> Automatic checks stopped after five minutes to avoid polling indefinitely. Reload status to check once more.</div> : null}
                  </div>
                ) : null}
                {run.status === 'paused' ? (
                  <div className="bail-paused mt-4" role="status" data-testid="status-search-paused">
                    <p className="font-semibold">Paused{run.progress.total > 0 ? `: ${run.progress.completed}/${run.progress.total} checked · ${run.progress.pending} pending` : ''}. Results found so far are kept below.</p>
                    {recovery?.message ? <p className="hint mt-1" data-testid="text-recovery-message">{recovery.message}</p> : run.reason ? <p className="hint mt-1">{run.reason}</p> : null}
                    {recovery && recovery.action === 'evidence_needed' ? <p className="hint mt-1">Some documents need evidence that is not in the workspace yet. Resuming would not help.</p> : null}
                    {recovery && recovery.action === 'source_blocked' ? <p className="hint mt-1">The source is not allowing access right now. This is not a temporary rate limit, so no resume is offered.</p> : null}
                    {recovery && recovery.action === 'new_search' ? <div className="mt-2"><p className="hint">This run cannot continue. Start a new search with the same criteria.</p><button type="button" className="btn mt-2" onClick={editSearch} data-testid="button-recovery-new-search">Edit this search</button></div> : null}
                    {resumeEligible ? (
                      <>
                        {recoveryWaiting && recoveryAt ? <p className="hint mt-1">Resume available {formatInstant(new Date(recoveryAt).toISOString())}.</p> : null}
                        <button type="button" className="btn mt-3" onClick={resumeRun} disabled={!canResume || resume.isPending} data-testid="button-resume-search">
                          {resume.isPending ? 'Resuming…' : recoveryWaiting || resumeWaiting ? 'Resume not yet available' : 'Resume search'}
                        </button>
                      </>
                    ) : !recovery || recovery.action === 'none' ? <p className="hint mt-2">This search cannot be resumed.</p> : null}
                    {resume.isError ? <p className="errbox mt-3" role="alert">Resume failed: {errMsg(resume.error)}</p> : null}
                  </div>
                ) : null}
                {run.status === 'complete' ? <p className="bail-complete mt-4" role="status">Search complete for the reported scope.</p> : null}
                {run.incomplete ? <div className="notice mt-3" data-testid="status-incomplete"><strong>Incomplete coverage.</strong> Treat the records below as partial; they do not represent all hearings or decisions in the date window.</div> : null}
                {run.reason && run.status !== 'paused' ? <p className="hint mt-2">{run.reason}</p> : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" onClick={() => exportRun('all')} disabled={!!exporting} data-testid="button-export-all">
                    <ArrowDownToLine size={17} aria-hidden="true" className="mr-2" />{exporting === 'all' ? 'Preparing CSV…' : allLabel}
                  </button>
                  <button type="button" className="btn" onClick={() => exportRun('matches')} disabled={!!exporting} data-testid="button-export-matches">
                    <ArrowDownToLine size={17} aria-hidden="true" className="mr-2" />{exporting === 'matches' ? 'Preparing CSV…' : matchLabel}
                  </button>
                </div>
                {exportError ? <p className="hint text-destructive mt-2" role="alert">{exportError}</p> : null}
                {lastExport ? <p className="hint mt-2" role="status" data-testid="status-last-export">{lastExport}</p> : null}
                {run.updatedAt ? <p className="hint mt-2 text-xs">Updated {formatInstant(run.updatedAt)}.</p> : null}
              </>
            ) : null}
          </div>

          {run && !statusQuery.isError ? (
            <div className="panel mt-4">
              <div className="bail-results-summary">
                <div><span className="bail-count" data-testid="text-match-count">{qualifying.length}</span><span className="hint"> within your amount filter</span></div>
                <p className="hint">Within your amount filter means a recorded monetary amount at or below your maximum, with no ambiguous decision flag. It does not imply release eligibility, current custody, release cost, or an operative order.</p>
              </div>
              <details className="mt-3" data-testid="details-glossary">
                <summary className="cursor-pointer mono font-semibold text-primary">What the categories mean</summary>
                <dl className="mt-2 space-y-2">
                  {GLOSSARY.map(([term, text]) => <div key={term}><dt className="font-semibold">{term}</dt><dd className="hint">{text}</dd></div>)}
                </dl>
              </details>
              {!results.length && run.status !== 'running' ? (
                <div className="bail-empty mt-4" data-testid="empty-results">
                  <AlertTriangle size={22} aria-hidden="true" />
                  {run.incomplete ? (
                    <div><strong>No records yet; this search is incomplete.</strong><p className="hint">Coverage stopped before evidence was found. An empty partial search says nothing about whether bail was set.</p></div>
                  ) : (
                    <div><strong>Zero collected dockets found for this window.</strong><p className="hint">No collected docket had a hearing in these dates. That does not establish that no hearings or bail decisions exist.</p></div>
                  )}
                </div>
              ) : null}
              {results.length > 0 && !qualifying.length && run.status !== 'running' ? (
                <div className="bail-empty mt-4" data-testid="empty-matches">
                  <Info size={22} aria-hidden="true" />
                  <div><strong>Records found, but none within your amount filter.</strong><p className="hint">{run.incomplete ? 'The search is also incomplete, so more records may exist. ' : ''}Inspect the other records below; some may be ambiguous or lack readable evidence.</p></div>
                </div>
              ) : null}
              {qualifying.length ? <ResultSection searchId={run.searchId} title="Within your amount filter" rows={qualifying} detail="These records show a recorded amount at or below your filter. Check the source quote and dates; this does not establish current custody, amount due, release eligibility, or an operative order." /> : null}
              <ResultSection searchId={run.searchId} title="Other, unknown, or outside the filter" rows={other} detail="Amounts in this section are outside your amount filter or unclear. They may be above the maximum, unknown, unsecured, denied, nonmonetary, or ambiguous." />
              {run.status === 'running' && !results.length ? <p className="hint mt-5">No results have been reported yet. Evidence may still be processing.</p> : null}
              {run.status !== 'running' ? (
                <section className="mt-7 border-t border-border pt-4" data-testid="section-next-steps">
                  <p className="bracket">Next steps</p>
                  <ol className="hint mt-2 space-y-1 list-decimal pl-5">
                    <li>Open each source document and compare it with the quoted evidence.</li>
                    <li>Save a result for review only if you want it in the shared workspace.</li>
                    <li>Review saved dockets in the <Link href="/review" className="underline" data-testid="link-next-review">review queue</Link> or see <Link href="/candidates" className="underline" data-testid="link-next-saved">Saved dockets</Link>.</li>
                    <li>Download a CSV of all records or only amount-filter matches.</li>
                    <li>Something missing or confusing? <Link href="/feedback" className="underline" data-testid="link-next-feedback">Tell us what you need</Link>.</li>
                  </ol>
                </section>
              ) : null}
            </div>
          ) : null}
          {stalled ? <div className="bail-stalled-foot"><RefreshCw size={16} aria-hidden="true" /> Monitoring is paused. <button type="button" className="underline" onClick={retryStatus}>Reload status</button></div> : null}
        </section>
      </div>
    </Shell>
  );
}
