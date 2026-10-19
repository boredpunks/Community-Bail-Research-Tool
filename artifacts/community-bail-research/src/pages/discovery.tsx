import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useListDiscoveryJobs,
  useGetDiscoveryJob,
  useControlDiscoveryJob,
  useSaveDiscoveryObservation,
  getListDiscoveryJobsQueryKey,
  getGetDiscoveryJobQueryKey,
  type DiscoveryItem,
  type DiscoveryControlAction,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import {
  uploadLocalDocument, isHttpsPortal,
  type ReportWithRequests, type EntryExt, type LocalUploadResult,
} from '@/components/discovery-api';
import { CATEGORY_LABEL, BASIS_LABEL, errMsg, formatCents, formatInstant, parseDollarsToCents } from '@/lib/money';

const VERIF: Record<string, string> = {
  PENDING: 'Saved, pending review',
  CONFIRMED: 'Source verified in review',
  REJECTED: 'Rejected in review',
};

function todayNY(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function readJobParam(): string {
  return new URLSearchParams(window.location.search).get('job') ?? '';
}
function writeJobParam(id: string) {
  const u = new URL(window.location.href);
  if (id) u.searchParams.set('job', id); else u.searchParams.delete('job');
  window.history.replaceState(null, '', u.toString());
}

function extractionLabel(o: string): string {
  switch (o) {
    case 'UNPROCESSED': return 'No PDF processed';
    case 'EXTRACTED': return 'Bail entries extracted';
    case 'MISSING_BAIL_SECTION': return 'No bail section found';
    case 'UNREADABLE': return 'Unreadable PDF';
    case 'UNSUPPORTED_LAYOUT': return 'Unsupported layout (partial or no extraction)';
    case 'IDENTITY_MISMATCH': return 'Docket identity did not match';
    case 'RETRIEVAL_FAILED': return 'Retrieval failed';
    default: return o;
  }
}
function postingLabel(s: string): string {
  if (s === 'SHOWN_POSTED') return 'SHOWN_POSTED: docket shows a posted entry (custody not verified)';
  if (s === 'NOT_SHOWN') return 'NOT_SHOWN: no posted entry on this page; not proof of unpaid bail or custody';
  return 'UNKNOWN: posting state uncertain';
}
function amountText(e: EntryExt) {
  if (e.amountCents != null) return formatCents(e.amountCents);
  return e.bailCategory === 'MONETARY' || e.bailCategory === 'UNKNOWN' ? 'Amount unknown' : 'No amount (unpriced)';
}

/* ---------- Row ---------- */
function ItemRow({ jobId, it, saving, onSave, saveErr, onUploaded }: {
  jobId: string; it: DiscoveryItem; saving: boolean; saveErr: string | null;
  onSave: (itemId: string, entryIndex: number | null) => void;
  onUploaded: (r: LocalUploadResult) => void;
}) {
  const p = it.provenance;
  const entries = p.entries as EntryExt[];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const upload = useMutation({
    mutationFn: (f: File) => uploadLocalDocument(f, { docketNumber: it.docketNumber, jobId, itemId: it.id }),
    onSuccess: (r) => {
      const ok = r.extractionOutcome === 'EXTRACTED';
      setUploadMsg({ ok, text: `Upload processed: ${extractionLabel(r.extractionOutcome)}.${r.detail ? ` ${r.detail}` : ''} Only extracted metadata is stored; keep your original PDF.` });
      onUploaded(r);
    },
    onError: (e) => setUploadMsg({ ok: false, text: `Upload failed: ${errMsg(e)}` }),
  });
  const savedFor = (idx: number | null) => it.savedObservations.find((o) => o.entryIndex === idx);
  const portal = isHttpsPortal(it.sourceUrl);

  return (
    <li className="panel" data-testid={`row-item-${it.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="mono text-sm">Row {it.position + 1}</span>
        <span className="mono font-bold break-all">{it.docketNumber}</span>
        <span className="tag" data-testid={`text-extraction-${it.id}`}>PDF: {extractionLabel(p.extractionOutcome)}</span>
        <span className={`tag ${p.postedEntryState === 'SHOWN_POSTED' ? 'text-warning' : ''}`}>Posting: {p.postedEntryState}</span>
      </div>
      {p.documentAcquisition === 'MANUAL_UPLOAD' ? <p className="hint mt-2"><strong>Local PDF verification, not automated retrieval.</strong> File received {formatInstant(it.sourceRetrievedAt)}. Keep your original PDF. Chronology and custody remain unreviewed.</p> : null}
      <p className="hint mt-2">
        Calendar: {p.eventType}, {p.eventDate ?? 'date not recorded'}; {p.courtOffice}{p.courtRoom ? `, room ${p.courtRoom}` : ''}; filed {p.filingDate ?? 'not recorded'}. {p.calendarUrl.startsWith('https://') ? `Calendar retrieved ${formatInstant(p.calendarRetrievedAt)}.` : 'No calendar retrieval is established for this local upload.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {portal ? (
          <a className="btn" href={it.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-source-${it.id}`}>Open source docket</a>
        ) : <span className="hint">No portal link available for this row.</span>}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" id={`file-${it.id}`}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setUploadMsg(null); upload.mutate(f); } }}
          data-testid={`input-upload-${it.id}`} />
        <button type="button" className="btn" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid={`button-upload-${it.id}`}>
          {upload.isPending ? 'Extracting…' : 'Upload downloaded PDF'}
        </button>
      </div>
      {uploadMsg ? <p className={uploadMsg.ok ? 'hint mt-2' : 'errbox mt-2'} role={uploadMsg.ok ? 'status' : 'alert'}>{uploadMsg.text}</p> : null}

      {p.extractionOutcome === 'UNPROCESSED' ? (
        <p className="hint mt-3">Calendar row only. Nothing can be saved until a PDF is uploaded and bail entries are extracted.</p>
      ) : entries.length === 0 ? (
        <div className="mt-3 border border-dashed border-border rounded p-3">
          <p className="font-semibold">No bail entries extracted.</p>
          <p className="hint">{extractionLabel(p.extractionOutcome)}. {it.detail ?? ''}</p>
        </div>
      ) : (
        <ol className="mt-3 space-y-2">
          {entries.map((e, i) => {
            const s = savedFor(i);
            return (
              <li key={i} className="border border-border rounded p-3" data-testid={`entry-${it.id}-${i}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="min-w-0">
                    <span className="mono text-sm">Entry {i + 1} of {entries.length}</span>
                    <p className="font-semibold">{e.action}; {e.orderDate ?? 'date not recorded'}</p>
                    <p>{CATEGORY_LABEL[e.bailCategory] ?? e.bailCategory}{e.financialBasis ? `, ${BASIS_LABEL[e.financialBasis]}` : ''}: <span className="mono font-semibold">{amountText(e)}</span></p>
                    <p className="hint">Originating court: {e.originatingCourt ?? 'Not recorded'}. Percentage condition: {e.percentageCondition ?? 'None recorded'}.</p>
                    <p className="hint">Source page{e.sourcePages?.length === 1 ? '' : 's'}: {e.sourcePages?.length ? e.sourcePages.join(', ') : 'Not recorded'}. Posting: {postingLabel(p.postedEntryState)}.</p>
                    <p className="hint whitespace-pre-wrap">Excerpt: {e.excerpt ?? it.excerpt ?? e.wording ?? 'None captured'}</p>
                  </div>
                  {s ? (
                    <p className="self-start text-right"><span className="tag text-primary">Saved</span><br /><span className="hint">{VERIF[s.reviewStatus] ?? s.reviewStatus}</span></p>
                  ) : (
                    <button type="button" className="btn btn-primary self-start" disabled={saving} onClick={() => onSave(it.id, i)} data-testid={`button-save-${it.id}-${i}`}>
                      Save entry {i + 1} pending review
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {saveErr ? <p className="errbox mt-3" role="alert">{saveErr}</p> : null}
      {it.savedObservations.length ? <p className="mt-2"><Link href="/review" className="underline text-primary">Open review queue</Link></p> : null}
      {p.documentSha256 ? <p className="hint mono mt-2 break-all">PDF SHA-256 {p.documentSha256}{p.documentPageCount ? `, ${p.documentPageCount} pages` : ''}</p> : null}
    </li>
  );
}

/* ---------- Page ---------- */
export default function Discovery() {
  const qc = useQueryClient();
  const jobs = useListDiscoveryJobs({ query: {
    queryKey: getListDiscoveryJobsQueryKey(),
  } });
  const control = useControlDiscoveryJob();
  const save = useSaveDiscoveryObservation();

  const [jobId, setJobIdRaw] = useState<string>(() => readJobParam());
  const setJobId = (id: string) => { setJobIdRaw(id); writeJobParam(id); };
  useEffect(() => {
    const h = () => setJobIdRaw(readJobParam());
    window.addEventListener('popstate', h);
    return () => window.removeEventListener('popstate', h);
  }, []);

  const today = todayNY();
  const office = 'ANY';
  const room = 'ANY';
  const eventType = 'ANY';
  const start = today;
  const end = today;
  const scheduled = true;
  const [ctlMsg, setCtlMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<{ id: string; msg: string } | null>(null);
  const [maxBail, setMaxBail] = useState('');
  const [excludePosted, setExcludePosted] = useState(false);
  const [soloDocket, setSoloDocket] = useState('');
  const [soloMsg, setSoloMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const soloRef = useRef<HTMLInputElement>(null);

  const selected = jobId || jobs.data?.[0]?.id || '';
  const report = useGetDiscoveryJob(selected, { query: {
    queryKey: getGetDiscoveryJobQueryKey(selected),
    enabled: !!selected,
  } });
  const data = report.data as ReportWithRequests | undefined;
  const job = data?.job;

  function refresh(id?: string) {
    if (id) qc.invalidateQueries({ queryKey: getGetDiscoveryJobQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListDiscoveryJobsQueryKey() });
  }

  const solo = useMutation({
    mutationFn: (f: File) => uploadLocalDocument(f, { docketNumber: soloDocket }),
    onSuccess: (r) => {
      setSoloMsg({ ok: r.extractionOutcome === 'EXTRACTED', text: `Upload processed: ${extractionLabel(r.extractionOutcome)}.${r.detail ? ` ${r.detail}` : ''} Showing local job ${r.jobId.slice(0, 8)}. Keep your original PDF; only extracted metadata is stored.` });
      setJobId(r.jobId); refresh(r.jobId);
    },
    onError: (e) => setSoloMsg({ ok: false, text: `Upload failed: ${errMsg(e)}` }),
  });

  function act(action: DiscoveryControlAction) {
    if (!selected) return;
    setCtlMsg(null);
    control.mutate({ jobId: selected, data: { action } }, {
      onSuccess: () => { setCtlMsg(`${action} accepted.`); refresh(selected); },
      onError: (er) => { setCtlMsg(`${action} failed: ${errMsg(er)}`); refresh(selected); },
    });
  }

  function doSave(itemId: string, entryIndex: number | null) {
    if (entryIndex == null) return; // never save bare calendar rows
    setSaveErr(null);
    save.mutate({ jobId: selected, itemId, data: { entryIndex } }, {
      onSuccess: () => {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/records') });
        refresh(selected);
      },
      onError: (er) => setSaveErr({ id: itemId, msg: `Not saved: ${errMsg(er)}` }),
    });
  }

  const maxCents = maxBail.trim() ? parseDollarsToCents(maxBail) : null;
  const maxInvalid = !!maxBail.trim() && maxCents == null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => items.filter((i) => {
    if (excludePosted && i.provenance.postedEntryState === 'SHOWN_POSTED') return false;
    if (maxCents != null) return i.provenance.entries.some((e) => e.bailCategory === 'MONETARY' && e.financialBasis === 'TOTAL_BAIL' && e.amountCents != null && e.amountCents <= maxCents);
    return true;
  }), [items, excludePosted, maxCents]);

  const requests = data?.requests ?? [];
  const searchReq = requests.filter((r) => r.method.toUpperCase() === 'POST' && /\/CaseSearch/i.test(r.path));
  const searchSubmitted = searchReq.some((r) => r.statusCode != null);
  const explicitEmpty = data?.events.some((ev) => ev.message.startsWith('EMPTY_RESULTS_VALIDATED')) ?? false;
  const rowState = !job ? '' : !job.calendarComplete ? 'Unknown: no validated calendar response'
    : items.length === 0 ? (explicitEmpty ? 'Validated explicit empty result' : 'Unknown: zero rows without explicit-empty validation')
    : `${items.length} validated row${items.length === 1 ? '' : 's'}`;
  const distinctDockets = new Set(items.map((i) => i.docketNumber)).size;
  const active = job?.status === 'QUEUED' || job?.status === 'RUNNING';
  return (
    <Shell>
      <PageHead label="Search" title="Calendar search and docket evidence">
        Search the Allegheny–05 Calendar Event scope, open each docket at its source, and upload the PDF you downloaded. Results are provisional; saving creates a pending observation for review. <Link href="/candidates" className="underline text-primary">Open saved candidates</Link>.
      </PageHead>

      <section className="panel mb-6" aria-labelledby="ops-h" data-testid="section-operations">
        <h2 id="ops-h" className="mono text-xl font-bold mb-2">Search status</h2>
        <p role="status">The search implementation is being rebuilt. Existing saved records and manual PDF uploads are unchanged.</p>
      </section>

      <div className="grid gap-6 md:grid-cols-[3fr_2fr] mb-8">
        <form className="panel space-y-3" data-testid="form-search">
          <h2 className="mono text-xl font-bold">Calendar Event search</h2>
          <p className="hint">County: <strong>Allegheny – 05</strong>. The controls are retained as layout only while search is rebuilt.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">Court office<input className="input w-full" value={office} disabled data-testid="input-office" /></label>
            <label className="block">Courtroom<input className="input w-full" value={room} disabled data-testid="input-room" /></label>
            <label className="block">Event type
              <input className="input w-full" list="event-types" value={eventType} disabled data-testid="input-event" />
              <datalist id="event-types"><option value="ANY" /><option value="Bail Hearing" /><option value="Preliminary Arraignment" /><option value="Formal Arraignment" /></datalist>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">Start date<input type="date" className="input w-full" value={start} disabled data-testid="input-start" /></label>
            <label className="block">End date<input type="date" className="input w-full" value={end} min={start} disabled data-testid="input-end" /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={scheduled} disabled data-testid="checkbox-scheduled" />Scheduled Events Only</label>
          <button type="button" className="btn btn-primary" disabled data-testid="button-search">
            Search is being rebuilt
          </button>
        </form>

        <section className="panel space-y-3" data-testid="section-local-upload">
          <h2 className="mono text-xl font-bold">Upload a docket PDF</h2>
          <p className="hint">Works without a calendar search. The PDF is read for bail entries; only extracted metadata is stored, not the file. Keep your original.</p>
          <label className="block">Expected docket number (optional)<input className="input w-full mono" value={soloDocket} onChange={(e) => setSoloDocket(e.target.value)} placeholder="CP-02-CR-0000000-2025" data-testid="input-solo-docket" /></label>
          <input ref={soloRef} type="file" accept="application/pdf,.pdf" className="sr-only" id="solo-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setSoloMsg(null); solo.mutate(f); } }} data-testid="input-solo-file" />
          <button type="button" className="btn" disabled={solo.isPending} onClick={() => soloRef.current?.click()} data-testid="button-solo-upload">
            {solo.isPending ? 'Extracting…' : 'Choose PDF'}
          </button>
          {soloMsg ? <p className={soloMsg.ok ? 'hint' : 'errbox'} role={soloMsg.ok ? 'status' : 'alert'}>{soloMsg.text}</p> : null}
        </section>
      </div>

      <section className="mb-6" aria-labelledby="jobs-h">
        <h2 id="jobs-h" className="mono text-xl font-bold mb-2">Jobs</h2>
        {jobs.isLoading ? <div className="skel h-10" /> : jobs.isError ? (
          <div className="errbox" role="alert">Could not load jobs. {errMsg(jobs.error)} <button type="button" className="btn ml-2" onClick={() => jobs.refetch()}>Retry</button></div>
        ) : !jobs.data?.length ? <p className="hint">No saved jobs yet. Manual PDF upload remains available.</p> : (
          <select className="input w-full" value={selected} onChange={(e) => setJobId(e.target.value)} data-testid="select-job">
            {jobs.data.map((j) => (
              <option key={j.id} value={j.id}>
                {formatInstant(j.createdAt)} · {j.status} · {j.criteria.eventType} {j.criteria.startDate}{j.criteria.endDate !== j.criteria.startDate ? `–${j.criteria.endDate}` : ''} · {j.discovered} rows · {j.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </section>

      {selected ? (
        report.isLoading ? <div className="skel h-40" aria-busy="true" /> : report.isError ? (
          <div className="errbox" role="alert">Could not load job. {errMsg(report.error)} <button type="button" className="btn ml-2" onClick={() => report.refetch()}>Retry</button></div>
        ) : job ? (
          <>
            <section className="panel mb-6" data-testid="section-report">
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="mono text-xl font-bold">Job {job.id.slice(0, 8)}: <span data-testid="text-status">{job.status}</span></h2>
                <div className="flex gap-2">
                  {active ? <><button type="button" className="btn" onClick={() => act('PAUSE')} disabled={control.isPending}>Pause</button>
                    <button type="button" className="btn btn-danger" onClick={() => act('CANCEL')} disabled={control.isPending}>Cancel</button></> : null}
                </div>
              </div>
              {ctlMsg ? <p className="hint mt-1" role="status">{ctlMsg}</p> : null}
              {job.message ? <p className="hint mt-1">{job.message}</p> : null}
              <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[14rem_1fr]">
                <dt className="mono text-sm">Criteria</dt><dd>{job.criteria.courtOffice} / room {job.criteria.courtRoom ?? 'ANY'} / {job.criteria.eventType}; {job.criteria.startDate} to {job.criteria.endDate}</dd>
                <dt className="mono text-sm">Search submitted</dt><dd data-testid="text-search-submitted">{searchReq.length === 0 ? 'No POST /CaseSearch in ledger' : searchSubmitted ? `Yes (POST /CaseSearch, HTTP ${searchReq[searchReq.length - 1].statusCode})` : `Attempted, not confirmed (${searchReq[searchReq.length - 1].outcome})`}</dd>
                <dt className="mono text-sm">Rows</dt><dd data-testid="text-row-state">{rowState}</dd>
                <dt className="mono text-sm">Distinct dockets</dt><dd>{distinctDockets}</dd>
                <dt className="mono text-sm">Coverage</dt><dd>Calendar {job.calendarComplete ? 'validated' : 'not validated'}; pagination {job.paginationComplete ? 'complete' : 'incomplete or unknown'}; result cap {job.resultCapReached ? 'reached, more results possible' : 'not reached'}.</dd>
                <dt className="mono text-sm">Limits</dt><dd>{job.requestsUsed}/{job.criteria.requestCap} requests ({job.failedRequests} failed); record cap {job.criteria.recordCap}.</dd>
              </dl>
              <details className="mt-3">
                <summary className="cursor-pointer mono font-semibold text-primary">Request ledger ({requests.length})</summary>
                {requests.length === 0 ? <p className="hint mt-2">No ledger entries reported.</p> : (
                  <div className="overflow-x-auto mt-2"><table className="w-full text-sm mono">
                    <thead><tr className="text-left"><th>Method</th><th>Path</th><th>Status</th><th>Outcome</th><th>Started</th><th>ms</th></tr></thead>
                    <tbody>{requests.map((r, i) => (
                      <tr key={i} className="border-t border-border"><td>{r.method}</td><td className="break-all">{r.path}</td><td>{r.statusCode ?? '–'}</td><td>{r.outcome}</td><td>{formatInstant(r.startedAt)}</td><td>{r.durationMs ?? '–'}</td></tr>
                    ))}</tbody>
                  </table></div>
                )}
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer mono font-semibold text-primary">Events ({data?.events.length ?? 0})</summary>
                <ul className="mt-2 space-y-1 text-sm">{data?.events.map((ev, i) => <li key={i}><span className="mono">{formatInstant(ev.createdAt)} {ev.kind}</span> {ev.message}</li>)}</ul>
              </details>
            </section>

            <section className="panel mb-4 flex flex-wrap items-end gap-4" data-testid="section-filters">
              <label className="block">Maximum bail (inclusive, dollars)<input className="input" value={maxBail} onChange={(e) => setMaxBail(e.target.value)} placeholder="e.g. 500" data-testid="input-max-bail" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={excludePosted} onChange={(e) => setExcludePosted(e.target.checked)} data-testid="checkbox-exclude-posted" />Exclude SHOWN_POSTED</label>
              <p className="hint">{maxInvalid ? 'Enter a valid dollar amount.' : `Showing ${visible.length} of ${items.length}.`} NOT_SHOWN does not mean unpaid or incarcerated.</p>
            </section>

            {items.length === 0 ? (
              <div className="panel border-dashed text-center"><p className="font-semibold">No rows in this job.</p><p className="hint">{rowState}</p></div>
            ) : visible.length === 0 ? (
              <div className="panel text-center"><p className="hint">No rows match these filters. Rows without extracted entries are hidden by a maximum bail filter.</p></div>
            ) : (
              <ul className="space-y-4">
                {visible.map((it) => (
                  <ItemRow key={it.id} jobId={job.id} it={it} saving={save.isPending}
                    saveErr={saveErr?.id === it.id ? saveErr.msg : null} onSave={doSave}
                    onUploaded={() => refresh(job.id)} />
                ))}
              </ul>
            )}
          </>
        ) : null
      ) : null}
    </Shell>
  );
}
