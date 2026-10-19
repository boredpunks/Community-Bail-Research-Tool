import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useGetDiscoveryPolicy,
  useCreateDiscoveryJob,
  getGetDiscoveryPolicyQueryKey,
  useListDiscoveryJobs,
  useGetDiscoveryJob,
  useControlDiscoveryJob,
  useSaveDiscoveryObservation,
  getListDiscoveryJobsQueryKey,
  getGetDiscoveryJobQueryKey,
  type DiscoveryItem,
  type DiscoveryControlAction,
  type DiscoveryJob,
} from '@workspace/api-client-react';
import { projectQualifyingRows, qualifyingRowsCsv, matchingEvents, eventConflict, type QualifyingRow, type MonetaryFilters } from '@workspace/bail-research';
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
    case 'AMBIGUOUS_FINANCIAL_ASSOCIATION': return 'Ambiguous financial association (amount not attributable)';
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

/* ---------- Helpers for search + results ---------- */
const OFFICES: { value: string; label: string }[] = [
  { value: 'CP-05-02-Crim', label: 'CP-05-02-Crim (Common Pleas criminal)' },
  { value: 'ANY', label: 'ANY (all offices, including MDJ)' },
];
const EVENT_TYPES = ['Formal Arraignment', 'Preliminary Hearing', 'Bail Hearing', 'Preliminary Arraignment'];
const PUBLIC_CASE_SEARCH = 'https://ujsportal.pacourts.us/CaseSearch';

/** Fixed collection filters recorded on the job. Legacy jobs keep strict maximum semantics. */
function fixedFilters(j: DiscoveryJob): MonetaryFilters {
  const f = j.criteria.matchFilters;
  if (!f) return {};
  return {
    monetaryUpperBoundCents: f.monetaryUpperBoundCents,
    monetaryLowerBoundCents: f.monetaryLowerBoundCents ?? null,
    excludeShownPosted: f.excludeShownPosted,
    requirePostedNotShown: f.requirePostedNotShown,
    inclusiveMaximum: f.inclusiveMaximum ?? false,
  };
}
function isLegacy(j: DiscoveryJob) { return j.criteria.resultVersion !== 2; }
function criteriaText(j: DiscoveryJob): string {
  const f = j.criteria.matchFilters;
  const max = f?.monetaryUpperBoundCents == null ? 'no maximum'
    : `maximum ${formatCents(f.monetaryUpperBoundCents)} (${(f.inclusiveMaximum ?? false) ? 'inclusive, ≤' : 'strict, <'})`;
  return `${max}${f?.excludeShownPosted ? '; SHOWN_POSTED excluded' : '; posted included'}`;
}
function downloadCsv(rows: QualifyingRow[], name: string) {
  const blob = new Blob([qualifyingRowsCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DocketLink({ row }: { row: { docketNumber: string; sourceUrl: string; itemId: string } }) {
  if (isHttpsPortal(row.sourceUrl)) {
    return <a className="mono font-semibold underline text-primary break-all" href={row.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-docket-${row.itemId}`}>{row.docketNumber}</a>;
  }
  return (
    <span className="break-all">
      <span className="mono font-semibold">{row.docketNumber}</span>{' '}
      <a className="hint underline" href={PUBLIC_CASE_SEARCH} target="_blank" rel="noopener noreferrer" data-testid={`link-public-search-${row.itemId}`}>search public case interface</a>
    </span>
  );
}

function EvidenceRow({ row, it }: { row: QualifyingRow; it: DiscoveryItem }) {
  const e = row.entry as EntryExt;
  const manual = it.provenance.documentAcquisition === 'MANUAL_UPLOAD';
  return (
    <div className="border-l-2 border-primary pl-3 py-2 space-y-1 text-sm" data-testid={`evidence-${row.itemId}-${row.entryIndex}`}>
      <p><strong>Matching event:</strong> {row.event.eventType}, {row.event.eventDate}{row.event.eventTime ? ` at ${row.event.eventTime}` : ''}{row.event.sourcePage ? ` (PDF page ${row.event.sourcePage})` : ''}.</p>
      <p><strong>Bail action:</strong> {e.action}; {e.orderDate ?? 'date not recorded'}. Category: {CATEGORY_LABEL[e.bailCategory] ?? e.bailCategory}.</p>
      <p><strong>Recorded amount:</strong> <span className="mono">{formatCents(row.amountCents)}</span>{e.financialBasis ? ` (${BASIS_LABEL[e.financialBasis] ?? e.financialBasis})` : ''}. Percentage: {e.percentageCondition ?? 'None recorded'}.</p>
      <p><strong>Supporting page{e.sourcePages?.length === 1 ? '' : 's'}:</strong> {e.sourcePages?.length ? e.sourcePages.join(', ') : 'Not recorded'}. Posting: {postingLabel(it.provenance.postedEntryState)}.</p>
      <p className="whitespace-pre-wrap"><strong>Excerpt:</strong> {e.excerpt ?? e.wording ?? 'None captured'}</p>
      <p className="hint">{manual ? `Local PDF received ${formatInstant(it.sourceRetrievedAt)}.` : `Docket retrieved ${formatInstant(it.sourceRetrievedAt)}.`} Historical, provisional observation from the docket record; not a reviewed operative order and not proof of current custody or unpaid bail.</p>
    </div>
  );
}

/* ---------- Page ---------- */
export default function Discovery() {
  const qc = useQueryClient();
  const policy = useGetDiscoveryPolicy({ query: { queryKey: getGetDiscoveryPolicyQueryKey() } });
  const jobs = useListDiscoveryJobs({ query: {
    queryKey: getListDiscoveryJobsQueryKey(),
  } });
  const create = useCreateDiscoveryJob();
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
  const pol = policy.data;
  const minDate = pol?.minimumDate && pol.minimumDate > today ? pol.minimumDate : today;
  const [office, setOffice] = useState('CP-05-02-Crim');
  const [eventType, setEventType] = useState('Formal Arraignment');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [formMax, setFormMax] = useState('');
  const [target, setTarget] = useState('10');
  const [formErr, setFormErr] = useState<string | null>(null);

  const [ctlMsg, setCtlMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<{ id: string; msg: string } | null>(null);
  const [maxBail, setMaxBail] = useState('');
  const [excludePosted, setExcludePosted] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [soloDocket, setSoloDocket] = useState('');
  const [soloMsg, setSoloMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const soloRef = useRef<HTMLInputElement>(null);

  const selected = jobId || jobs.data?.[0]?.id || '';
  const report = useGetDiscoveryJob(selected, { query: {
    queryKey: getGetDiscoveryJobQueryKey(selected),
    enabled: !!selected,
    refetchInterval: (q) => {
      const st = (q.state.data as ReportWithRequests | undefined)?.job.status;
      return st === 'QUEUED' || st === 'RUNNING' ? 3000 : false;
    },
  } });
  const data = report.data as ReportWithRequests | undefined;
  const job = data?.job;

  function refresh(id?: string) {
    if (id) qc.invalidateQueries({ queryKey: getGetDiscoveryJobQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListDiscoveryJobsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDiscoveryPolicyQueryKey() });
  }

  // Refresh job list when the selected job reaches a terminal state.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastStatus.current && lastStatus.current !== job?.status) {
      qc.invalidateQueries({ queryKey: getListDiscoveryJobsQueryKey() });
    }
    lastStatus.current = job?.status;
  }, [job?.status, qc]);

  function submitSearch(ev: React.FormEvent) {
    ev.preventDefault();
    setFormErr(null);
    const cents = formMax.trim() ? parseDollarsToCents(formMax) : null;
    if (formMax.trim() && cents == null) { setFormErr('Enter a valid maximum in dollars, for example 500 or 1500.00.'); return; }
    const t = Number(target);
    const maxT = Math.min(200, pol?.maxRecordCap ?? 200);
    if (!Number.isInteger(t) || t < 1 || t > maxT) { setFormErr(`Matching dockets wanted must be a whole number from 1 to ${maxT}.`); return; }
    if (!start || !end || end < start) { setFormErr('End date must be on or after start date.'); return; }
    if (start < minDate) { setFormErr(`Start date must be ${minDate} or later.`); return; }
    const recordCap = Math.min(pol?.maxRecordCap ?? 200, Math.max(pol?.defaultRecordCap ?? t, t));
    const requestCap = Math.max(8, Math.min(pol?.maxRequestCap ?? 500, pol?.defaultRequestCap ?? 8));
    create.mutate({ data: {
      courtOffice: office, courtRoom: 'ANY', eventType, startDate: start, endDate: end,
      recordCap, requestCap, matchTarget: t,
      matchFilters: { monetaryUpperBoundCents: cents, excludeShownPosted: false, inclusiveMaximum: true },
    } }, {
      onSuccess: (j) => { setJobId(j.id); setMaxBail(''); setExcludePosted(false); setCtlMsg(null); refresh(j.id); },
      onError: (er) => setFormErr(`Search not started: ${errMsg(er)}`),
    });
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
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // One shared projection: fixed collection criteria, then optional display-only narrowing intersected.
  const fixed = useMemo(() => (job ? fixedFilters(job) : {}), [job]);
  const fixedRows = useMemo(() => projectQualifyingRows(items, fixed), [items, fixed]);
  const rows = useMemo(() => {
    if (maxCents == null && !excludePosted) return fixedRows;
    const narrowed = new Set(projectQualifyingRows(items, {
      monetaryUpperBoundCents: maxCents, inclusiveMaximum: true, excludeShownPosted: excludePosted,
    }).map((r) => r.key));
    return fixedRows.filter((r) => narrowed.has(r.key));
  }, [items, fixedRows, maxCents, excludePosted]);
  const matchingIds = useMemo(() => new Set(fixedRows.map((r) => r.itemId)), [fixedRows]);

  const outcomes = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.provenance.extractionOutcome, (m.get(i.provenance.extractionOutcome) ?? 0) + 1);
    return [...m.entries()];
  }, [items]);
  const conflicts = useMemo(() => items.filter((i) => matchingEvents(i.provenance).some((e) => eventConflict(e, i.provenance))), [items]);
  const noEvent = useMemo(() => items.filter((i) => i.provenance.extractionOutcome === 'EXTRACTED' && matchingEvents(i.provenance).length === 0), [items]);
  const excluded = useMemo(() => items.filter((i) => !matchingIds.has(i.id)), [items, matchingIds]);

  const requests = data?.requests ?? [];
  const searchReq = requests.filter((r) => r.method.toUpperCase() === 'POST' && /\/CaseSearch/i.test(r.path));
  const searchSubmitted = searchReq.some((r) => r.statusCode != null);
  const explicitEmpty = data?.events.some((ev) => ev.message.startsWith('EMPTY_RESULTS_VALIDATED')) ?? false;
  const rowState = !job ? '' : !job.calendarComplete ? 'Unknown: no validated calendar response'
    : items.length === 0 ? (explicitEmpty ? 'Validated explicit empty result' : 'Unknown: zero rows without explicit-empty validation')
    : `${items.length} validated row${items.length === 1 ? '' : 's'}`;
  const distinctDockets = new Set(items.map((i) => i.docketNumber)).size;
  const active = job?.status === 'QUEUED' || job?.status === 'RUNNING';
  const expired = !!job?.resultsExpiredAt;
  const terminal = job && !active && job.status !== 'PAUSED';
  const partial = !!job && (job.status === 'CANCELLED' || job.status === 'FAILED' || job.status === 'PAUSED' || job.unprocessed > 0 || !job.paginationComplete);
  const targetN = job?.criteria.matchTarget;
  const targetNote = !job || targetN == null ? null
    : job.targetReached ? `Target of ${targetN} matching docket${targetN === 1 ? '' : 's'} reached.`
    : active ? `Collecting toward ${targetN} matching docket${targetN === 1 ? '' : 's'}.`
    : job.status === 'COMPLETED' && job.paginationComplete && job.unprocessed === 0 ? `Target unmet: candidates exhausted with ${job.matching} of ${targetN} matching dockets.`
    : `Target unmet: the job stopped (${job.status}) before full coverage; ${job.matching} of ${targetN} matching dockets.`;
  const pct = job && job.discovered > 0 ? Math.min(100, Math.round((job.processed / job.discovered) * 100)) : 0;
  const blockers = pol ? [
    !pol.collectionEnabled ? 'Automated collection is not enabled in the current policy.' : null,
    pol.blockedReason ? `Blocked: ${pol.blockedReason}` : null,
    pol.pausedUntil ? `Source paused until ${formatInstant(pol.pausedUntil)}.` : null,
    pol.latencyWarning ? `Latency warning: ${pol.latencyWarning}` : null,
  ].filter(Boolean) as string[] : [];

  return (
    <Shell>
      <PageHead label="Search" title="Calendar search and docket evidence">
        Search the Allegheny–05 Calendar Event scope for recorded monetary bail observations, open each docket at its source, or upload a PDF you downloaded. Results are provisional historical observations, not operative orders. Saving is optional and creates a pending observation for review. <Link href="/candidates" className="underline text-primary">Open saved candidates</Link>.
      </PageHead>

      <section className="panel mb-6" aria-labelledby="ops-h" data-testid="section-operations">
        <h2 id="ops-h" className="mono text-xl font-bold mb-2">Source coverage</h2>
        <ul className="space-y-1" role="status">
          <li><span className="tag">Offline fixtures</span> Common Pleas and MDJ parsing verified against genuine PDF fixtures.</li>
          <li><span className="tag text-warning">Live / deployed</span> Not yet established. Live calendar retrieval has not been verified end to end; treat zero or partial results as unverified coverage.</li>
          {pol?.coverageNote ? <li className="hint">{pol.coverageNote}</li> : null}
        </ul>
        {policy.isLoading ? <div className="skel h-6 mt-2" /> : policy.isError ? (
          <p className="errbox mt-2" role="alert">Collection policy unavailable. {errMsg(policy.error)} <button type="button" className="btn ml-2" onClick={() => policy.refetch()} data-testid="button-retry-policy">Retry</button></p>
        ) : blockers.length ? (
          <ul className="errbox mt-2 space-y-1" role="alert" data-testid="list-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        ) : null}
        {pol ? (
          <details className="mt-2">
            <summary className="cursor-pointer mono font-semibold text-primary">Policy details</summary>
            <p className="hint mt-1 mono">Adapter {pol.adapter}; pilot {pol.pilotState}; spacing {pol.currentSpacingMs} ms; concurrency {pol.concurrency}; requests {pol.hourlyRequestsUsed}/{pol.hourlyRequestCap} hourly, {pol.dailyRequestsUsed}/{pol.dailyRequestCap} daily; access verified {pol.accessVerifiedAt ? formatInstant(pol.accessVerifiedAt) : 'no'}; next eligible {pol.nextEligibleAt ? formatInstant(pol.nextEligibleAt) : 'now'}.</p>
          </details>
        ) : null}
      </section>

      <div className="grid gap-6 md:grid-cols-[3fr_2fr] mb-8">
        <form className="panel space-y-3" data-testid="form-search" onSubmit={submitSearch}>
          <h2 className="mono text-xl font-bold">Calendar Event search</h2>
          <p className="hint">County: <strong>Allegheny – 05</strong>. Courtroom: ANY. Event labels are resolved against the live portal options when the job runs.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">Court office
              <select className="input w-full" value={office} onChange={(e) => setOffice(e.target.value)} data-testid="select-office">
                {OFFICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">Event type
              <select className="input w-full" value={eventType} onChange={(e) => setEventType(e.target.value)} data-testid="select-event">
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">Start date<input type="date" className="input w-full" value={start} min={minDate} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} data-testid="input-start" /></label>
            <label className="block">End date<input type="date" className="input w-full" value={end} min={start} onChange={(e) => setEnd(e.target.value)} data-testid="input-end" /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">Maximum bail, inclusive (optional, dollars)<input className="input w-full mono" inputMode="decimal" value={formMax} onChange={(e) => setFormMax(e.target.value)} placeholder="No maximum" data-testid="input-form-max" /></label>
            <label className="block">Matching dockets wanted<input type="number" min={1} max={Math.min(200, pol?.maxRecordCap ?? 200)} className="input w-full mono" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="input-target" /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked disabled data-testid="checkbox-scheduled" />Scheduled Events Only (enforced)</label>
          <p className="hint">Posted bail is included. Target counts distinct dockets, not table rows. Budgets: record cap {pol ? `${pol.defaultRecordCap} default, ${pol.maxRecordCap} max` : 'loading'}; request cap {pol ? `${pol.defaultRequestCap} default, ${pol.maxRequestCap} max` : 'loading'}.</p>
          {formErr ? <p className="errbox" role="alert" data-testid="text-form-error">{formErr}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={create.isPending || policy.isLoading} data-testid="button-search">
            {create.isPending ? 'Starting…' : 'Start search'}
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
        ) : !jobs.data?.length ? <p className="hint">No saved jobs yet. Start a search or upload a PDF.</p> : (
          <select className="input w-full" value={selected} onChange={(e) => { setJobId(e.target.value); setMaxBail(''); setExcludePosted(false); setOpenRow(null); }} data-testid="select-job">
            {jobs.data.map((j) => (
              <option key={j.id} value={j.id}>
                {formatInstant(j.createdAt)} · {j.status} · {j.criteria.eventType} {j.criteria.startDate}{j.criteria.endDate !== j.criteria.startDate ? `–${j.criteria.endDate}` : ''} · {j.matching} matching / {j.discovered} rows{isLegacy(j) ? ' · legacy' : ''} · {j.id.slice(0, 8)}
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
                <h2 className="mono text-xl font-bold">Job {job.id.slice(0, 8)}: <span data-testid="text-status">{job.status}</span>{isLegacy(job) ? <span className="tag ml-2" data-testid="tag-legacy">Legacy semantics</span> : null}</h2>
                <div className="flex gap-2">
                  {active ? <button type="button" className="btn" onClick={() => act('PAUSE')} disabled={control.isPending} data-testid="button-pause">Pause</button> : null}
                  {job.status === 'PAUSED' ? <button type="button" className="btn btn-primary" onClick={() => act('RESUME')} disabled={control.isPending} data-testid="button-resume">Resume</button> : null}
                  {active || job.status === 'PAUSED' ? <button type="button" className="btn btn-danger" onClick={() => act('CANCEL')} disabled={control.isPending} data-testid="button-cancel">Cancel</button> : null}
                </div>
              </div>
              {ctlMsg ? <p className="hint mt-1" role="status">{ctlMsg}</p> : null}
              {job.message ? <p className="hint mt-1">{job.message}</p> : null}
              <div className="mt-3" data-testid="progress-job">
                <div className="h-2 rounded bg-border overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-primary origin-left transition-transform" style={{ transform: `scaleX(${pct / 100})` }} />
                </div>
                <p className="hint mt-1 mono">{job.processed}/{job.discovered} candidate dockets processed; {job.matching} matching{targetN != null ? ` of ${targetN} wanted` : ''}; {job.failed} failed; {job.unprocessed} unprocessed.{active ? ' Updating every few seconds.' : ''}</p>
              </div>
              {targetNote ? <p className={`mt-2 ${job.targetReached ? '' : 'font-semibold'}`} data-testid="text-target">{targetNote}</p> : null}
              {expired ? <p className="errbox mt-2" role="alert" data-testid="text-expired">Results expired {formatInstant(job.resultsExpiredAt)}. Evidence detail is no longer available; run the search again.</p>
                : job.resultsExpireAt ? <p className="hint mt-1">Results kept until {formatInstant(job.resultsExpireAt)}.</p> : null}
              {partial && terminal ? <p className="errbox mt-2" role="status" data-testid="text-partial">Partial coverage: {!job.paginationComplete ? 'calendar pagination incomplete or unknown; ' : ''}{job.unprocessed > 0 ? `${job.unprocessed} candidates not processed; ` : ''}{job.resultCapReached ? 'record cap reached, more results possible. ' : ''}Rows shown are preserved partial results.</p> : null}
              <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[14rem_1fr]">
                <dt className="mono text-sm">Criteria</dt><dd>{job.criteria.courtOffice} / room {job.criteria.courtRoom ?? 'ANY'} / {job.criteria.eventType}; {job.criteria.startDate} to {job.criteria.endDate}</dd>
                <dt className="mono text-sm">Collection filter</dt><dd data-testid="text-fixed-filter">{criteriaText(job)}{isLegacy(job) ? '. Legacy job: strict maximum preserved.' : ''}</dd>
                <dt className="mono text-sm">Rows</dt><dd data-testid="text-row-state">{rowState}</dd>
                <dt className="mono text-sm">Distinct dockets</dt><dd>{distinctDockets} candidate; {matchingIds.size} matching ({fixedRows.length} observation row{fixedRows.length === 1 ? '' : 's'})</dd>
                <dt className="mono text-sm">Outcomes</dt><dd data-testid="text-outcomes">{outcomes.length ? outcomes.map(([k, n]) => `${extractionLabel(k)}: ${n}`).join('; ') : 'None yet'}{conflicts.length ? `; event-date conflicts withheld: ${conflicts.length}` : ''}{noEvent.length ? `; no matching event date: ${noEvent.length}` : ''}</dd>
                <dt className="mono text-sm">Coverage</dt><dd>Calendar {job.calendarComplete ? 'validated' : 'not validated'}; pagination {job.paginationComplete ? 'complete' : 'incomplete or unknown'}; result cap {job.resultCapReached ? 'reached, more results possible' : 'not reached'}.</dd>
                <dt className="mono text-sm">Limits</dt><dd>{job.requestsUsed}/{job.criteria.requestCap} requests ({job.failedRequests} failed); record cap {job.criteria.recordCap}.</dd>
                <dt className="mono text-sm">Document accounting</dt><dd data-testid="text-document-accounting">{job.documentsAttempted ?? 'Not retained'} attempted; {job.documentsRetrieved ?? 'not retained'} retrieved; {job.documentsParsed ?? 'not retained'} parsed; {job.excluded ?? 'not retained'} excluded; {job.ambiguities ?? 'not retained'} financial ambiguities. {job.displayedRows ?? 'Not retained'} fixed-criteria observation rows.</dd>
              </dl>
              <details className="mt-3">
                <summary className="cursor-pointer mono font-semibold text-primary">Request ledger ({requests.length})</summary>
                <p className="hint mt-1" data-testid="text-search-submitted">Search submitted: {searchReq.length === 0 ? 'No POST /CaseSearch in ledger' : searchSubmitted ? `Yes (POST /CaseSearch, HTTP ${searchReq[searchReq.length - 1].statusCode})` : `Attempted, not confirmed (${searchReq[searchReq.length - 1].outcome})`}</p>
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
              <label className="block">Narrow display: maximum (inclusive, dollars)<input className="input" value={maxBail} onChange={(e) => setMaxBail(e.target.value)} placeholder="e.g. 500" data-testid="input-max-bail" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={excludePosted} onChange={(e) => setExcludePosted(e.target.checked)} data-testid="checkbox-exclude-posted" />Hide SHOWN_POSTED</label>
              <button type="button" className="btn" disabled={rows.length === 0 || maxInvalid} onClick={() => downloadCsv(rows, `bail-observations-${job.id.slice(0, 8)}.csv`)} data-testid="button-export-csv">Export displayed rows (CSV)</button>
              <p className="hint w-full">{maxInvalid ? 'Enter a valid dollar amount.' : `Showing ${rows.length} of ${fixedRows.length} qualifying rows.`} Display narrowing never changes the job's criteria, target, or budget. NOT_SHOWN does not mean unpaid or incarcerated.</p>
            </section>

            {expired ? null : fixedRows.length === 0 ? (
              <div className="panel border-dashed text-center mb-6" data-testid="empty-results">
                <p className="font-semibold">{active ? 'No qualifying rows yet.' : 'No qualifying monetary observations.'}</p>
                <p className="hint">{items.length === 0 ? rowState : 'Processed dockets are listed below with their outcomes. Missing amounts, nonmonetary entries, ambiguous associations and unresolved event dates are excluded from the table.'}</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="panel text-center mb-6"><p className="hint">No rows match the display narrowing.</p></div>
            ) : (
              <div className="panel mb-6 overflow-x-auto p-0">
                <table className="w-full text-left" data-testid="table-results">
                  <thead><tr className="mono text-sm border-b border-border"><th className="p-3">Hearing date</th><th className="p-3">Docket number</th><th className="p-3 text-right">Bail amount</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const it = itemById.get(r.itemId);
                      const open = openRow === r.key;
                      return (
                        <tr key={r.key} className="border-b border-border align-top" data-testid={`row-result-${r.itemId}-${r.entryIndex}`}>
                          <td className="p-3 mono whitespace-nowrap">
                            <button type="button" className="underline text-primary" aria-expanded={open} onClick={() => setOpenRow(open ? null : r.key)} data-testid={`button-expand-${r.itemId}-${r.entryIndex}`}>{open ? '−' : '+'} {r.hearingDate}</button>
                          </td>
                          <td className="p-3">
                            <DocketLink row={r} />
                            {open && it ? <div className="mt-2"><EvidenceRow row={r} it={it} /></div> : null}
                          </td>
                          <td className="p-3 mono text-right whitespace-nowrap">{formatCents(r.amountCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {items.length > 0 && !expired ? (
              <details className="mb-6" open={fixedRows.length === 0 && !active}>
                <summary className="cursor-pointer mono font-semibold text-primary" data-testid="summary-dockets">All processed dockets, evidence, upload and saving ({items.length}; {excluded.length} not in table)</summary>
                <ul className="space-y-4 mt-3">
                  {items.map((it) => (
                    <ItemRow key={it.id} jobId={job.id} it={it} saving={save.isPending}
                      saveErr={saveErr?.id === it.id ? saveErr.msg : null} onSave={doSave}
                      onUploaded={() => refresh(job.id)} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null
      ) : null}
    </Shell>
  );
}
