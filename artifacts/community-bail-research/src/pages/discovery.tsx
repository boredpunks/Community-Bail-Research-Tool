import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDiscoveryPolicy,
  useListDiscoveryAssessments,
  getListDiscoveryAssessmentsQueryKey,
  getGetDiscoveryPolicyQueryKey,
  useListDiscoveryJobs,
  useCreateDiscoveryJob,
  useGetDiscoveryJob,
  useControlDiscoveryJob,
  useSaveDiscoveryObservation,
  useSaveDiscoveryCandidates,
  getListDiscoveryJobsQueryKey,
  getGetDiscoveryJobQueryKey,
  type DiscoveryItem,
  type DiscoveryControlAction,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { ExpiredResultsNotice, ResumeControl } from '@/components/discovery-retention';
import { CATEGORY_LABEL, BASIS_LABEL, errMsg, formatCents, formatInstant, parseDollarsToCents } from '@/lib/money';

const POLL_MS = 3000;

function dayNum(d: string) { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400000; }

type Saved = DiscoveryItem['savedObservations'][number];
const VERIF: Record<string, string> = {
  PENDING: 'Saved, awaiting source verification',
  CONFIRMED: 'Source verified in review',
  REJECTED: 'Rejected in review',
};
function savedFor(it: DiscoveryItem, idx: number | null): Saved | undefined {
  return it.savedObservations.find((o) => o.entryIndex === idx);
}
function isMonetaryTotal(e: DiscoveryItem['provenance']['entries'][number]) {
  return e.bailCategory === 'MONETARY' && e.financialBasis === 'TOTAL_BAIL' && e.amountCents != null && Number.isInteger(e.amountCents);
}
function amountText(e: DiscoveryItem['provenance']['entries'][number]) {
  if (e.amountCents != null) return formatCents(e.amountCents);
  return e.bailCategory === 'MONETARY' || e.bailCategory === 'UNKNOWN' ? 'Amount unknown' : 'No amount (unpriced)';
}

function canSaveCandidate(it: DiscoveryItem) {
  if (!it.sourceRetrievedAt || !Number.isFinite(Date.parse(it.sourceRetrievedAt))) return false;
  if (it.provenance.extractionOutcome === 'EXTRACTED') return it.provenance.entries.length > 0 && !!it.excerpt;
  if (it.provenance.extractionOutcome === 'MISSING_BAIL_SECTION') return it.provenance.entries.length === 0 && !!it.detail;
  return false;
}

function amountMatches(it: DiscoveryItem, boundCents: number): boolean {
  return it.provenance.entries.some((e) => isMonetaryTotal(e) && (e.amountCents as number) < boundCents);
}

function ItemRow({ jobId, it, saving, onSave, err, selected, onSelect }: {
  jobId: string; it: DiscoveryItem; saving: boolean; err: string | null;
  onSave: (itemId: string, entryIndex: number | null) => void;
  selected: boolean; onSelect: (itemId: string, checked: boolean) => void;
}) {
  const p = it.provenance;
  const saved = it.savedObservations.length > 0;
  return (
    <li id={`item-${it.id}`} className="panel scroll-mt-4" data-testid={`row-item-${it.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {canSaveCandidate(it) ? (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(it.id, e.target.checked)} data-testid={`checkbox-candidate-${it.id}`} />
            Select docket
          </label>
        ) : null}
        <span className="mono text-sm">Source position {it.position + 1}</span>
        <a className="mono font-bold underline text-primary break-all" href={it.sourceUrl} target="_blank" rel="noopener noreferrer">{it.docketNumber}</a>
        {saved
          ? <span className="tag text-primary" data-testid={`status-saved-${it.id}`}>Saved: {it.savedObservations.length} observation{it.savedObservations.length === 1 ? '' : 's'}</span>
          : <span className="tag text-warning" data-testid={`status-pending-${it.id}`}>Not yet saved</span>}
        <span className="tag">{p.extractionOutcome}</span>
      </div>
      <p className="hint mt-2">
        Event {p.eventType}, {p.eventDate ?? 'date not recorded'}; filed {p.filingDate ?? 'not recorded'}; {p.courtOffice}. Posted entry state: <strong>{p.postedEntryState}</strong>
        {p.postedEntryState === 'UNKNOWN' ? ' (uncertain: this does not mean not posted)' : p.postedEntryState === 'SHOWN_POSTED' ? ' (the docket shows a posted entry; custody is not verified)' : ' (no posted entry shown on this page; not proof of release or custody)'}.
      </p>
      {p.entries.length === 0 ? (
        <div className="mt-3 border border-dashed border-border rounded p-3">
          <p className="font-semibold">No bail entries extracted.</p>
          <p className="hint">Extraction outcome: {p.extractionOutcome}. {it.detail ?? ''}</p>
          {p.extractionOutcome === 'MISSING_BAIL_SECTION' ? (
            savedFor(it, null)
              ? <p className="mt-2 font-semibold" data-testid={`status-entry-${it.id}-none`}>Saved as UNKNOWN: {VERIF[savedFor(it, null)!.reviewStatus]}</p>
              : <button type="button" className="btn mt-2" disabled={saving} onClick={() => onSave(it.id, null)} data-testid={`button-save-unknown-${it.id}`}>
              Save as UNKNOWN (no bail section)
            </button>
          ) : null}
        </div>
      ) : (
        <ol className="mt-3 space-y-2">
          {p.entries.map((e, i) => (
            <li key={i} className="border border-border rounded p-3" data-testid={`entry-${it.id}-${i}`}>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <span className="mono text-sm">Entry {i + 1} of {p.entries.length}</span>
                  <p className="font-semibold">{e.action}; {e.orderDate ?? 'order date not recorded'}</p>
                  <p>{CATEGORY_LABEL[e.bailCategory]}{e.financialBasis ? `, ${BASIS_LABEL[e.financialBasis]}` : ''}: <span className="mono font-semibold">{amountText(e)}</span></p>
                  <p className="hint whitespace-pre-wrap">Wording: {e.wording}</p>
                </div>
                {savedFor(it, i) ? (
                  <p className="self-start text-right" data-testid={`status-entry-${it.id}-${i}`}>
                    <span className="tag text-primary">Saved</span><br />
                    <span className="hint">{VERIF[savedFor(it, i)!.reviewStatus]}</span>
                  </p>
                ) : (
                  <button type="button" className="btn btn-primary self-start" disabled={saving} onClick={() => onSave(it.id, i)} data-testid={`button-save-${it.id}-${i}`}>
                    Save entry {i + 1} as pending
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {err ? <p className="errbox mt-3" role="alert">{err}</p> : null}
      {saved ? <p className="mt-2"><Link href="/review" className="underline text-primary" data-testid={`link-review-${it.id}`}>Open review queue</Link> <span className="hint">(saving creates a pending observation; verification against the source is a separate review step, and some saved entries may already be verified)</span></p> : null}
      <details className="mt-2">
        <summary className="cursor-pointer mono font-semibold text-primary">Source and evidence</summary>
        <dl className="mt-3 grid gap-2 text-base md:grid-cols-[12rem_1fr]">
          <dt className="mono text-sm">Docket page</dt><dd className="break-all"><a className="underline text-primary" href={it.sourceUrl} target="_blank" rel="noopener noreferrer">{it.sourceUrl}</a></dd>
          <dt className="mono text-sm">Docket retrieved</dt><dd>{formatInstant(it.sourceRetrievedAt)}</dd>
          <dt className="mono text-sm">Calendar page</dt><dd className="break-all"><a className="underline text-primary" href={p.calendarUrl} target="_blank" rel="noopener noreferrer">{p.calendarUrl}</a></dd>
          <dt className="mono text-sm">Calendar retrieved</dt><dd>{formatInstant(p.calendarRetrievedAt)}</dd>
          <dt className="mono text-sm">Excerpt</dt><dd className="whitespace-pre-wrap">{it.excerpt ?? 'No excerpt captured.'}</dd>
          <dt className="mono text-sm">Detail</dt><dd>{it.detail ?? 'None'}</dd>
        </dl>
        <p className="hint mt-2">All chronology is retained above. Nothing is marked latest or operative automatically; job {jobId.slice(0, 8)}.</p>
      </details>
    </li>
  );
}

export default function Discovery() {
  const qc = useQueryClient();
  const policy = useGetDiscoveryPolicy({ query: { queryKey: getGetDiscoveryPolicyQueryKey(), refetchInterval: 30_000 } });
  const assessments = useListDiscoveryAssessments({ query: { queryKey: getListDiscoveryAssessmentsQueryKey(), refetchInterval: 30_000 } });
  const jobs = useListDiscoveryJobs({ query: {
    queryKey: getListDiscoveryJobsQueryKey(),
    refetchInterval: (q) => q.state.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? POLL_MS : false,
  } });
  const create = useCreateDiscoveryJob();
  const control = useControlDiscoveryJob();
  const save = useSaveDiscoveryObservation();
  const saveCandidates = useSaveDiscoveryCandidates();

  const [jobId, setJobId] = useState<string>('');
  const [startE, setStart] = useState<string | undefined>();
  const [endE, setEnd] = useState<string | undefined>();
  const [recCapE, setRecCap] = useState<string | undefined>();
  const [reqCapE, setReqCap] = useState<string | undefined>();
  const [formErr, setFormErr] = useState<string | null>(null);
  const [ctlMsg, setCtlMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<{ id: string; msg: string } | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [candidateMsg, setCandidateMsg] = useState<string | null>(null);
  const [filterOn, setFilterOn] = useState(false);
  const [postedOff, setPostedOff] = useState(false);
  const [bound, setBound] = useState('500');
  const [target, setTarget] = useState('1');
  const [collectMonetary, setCollectMonetary] = useState(true);
  const [collectBound, setCollectBound] = useState('500');
  const [collectPosted, setCollectPosted] = useState(false);

  const pol = policy.data;
  const start = startE ?? pol?.minimumDate ?? '';
  const end = endE ?? start;
  const tgtNum = Number(target);
  const recCap = recCapE ?? (pol ? String(Math.min(pol.maxRecordCap, Math.max(pol.defaultRecordCap, Number.isInteger(tgtNum) ? tgtNum : 0))) : '');
  const reqCap = reqCapE ?? (pol ? String(pol.defaultRequestCap) : '');
  const selected = jobId || jobs.data?.[0]?.id || '';

  const report = useGetDiscoveryJob(selected, {
    query: {
      queryKey: getGetDiscoveryJobQueryKey(selected),
      enabled: !!selected,
      refetchInterval: (q) => {
        const st = q.state.data?.job.status;
        return st === 'QUEUED' || st === 'RUNNING' ? POLL_MS : false;
      },
    },
  });
  const job = report.data?.job;

  const boundCents = parseDollarsToCents(bound);
  const filtering = filterOn && boundCents != null;
  const items = report.data?.items ?? [];
  const matching = useMemo(() => items.filter((i) =>
    (!postedOff || i.provenance.postedEntryState !== 'SHOWN_POSTED') &&
    (!filtering || amountMatches(i, boundCents as number))), [items, filtering, boundCents, postedOff]);
  const anyFilter = filtering || postedOff;

  function refreshJob(id: string) {
    qc.invalidateQueries({ queryKey: getGetDiscoveryJobQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListDiscoveryJobsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDiscoveryPolicyQueryKey() });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormErr(null);
    if (!pol) return;
    if (!pol.collectionEnabled) return setFormErr(`Collection is blocked: ${pol.blockedReason}. No source request sent.`);
    const rc = Number(recCap), qc2 = Number(reqCap);
    const mt = Number(target), upper = parseDollarsToCents(collectBound);
    if (!start || !end) return setFormErr('Choose a start and end date.');
    if (start < pol.minimumDate) return setFormErr(`Start date cannot be before ${pol.minimumDate}. Earlier history is not proven.`);
    if (end < start) return setFormErr('End date cannot be before start date.');
    if (dayNum(end) - dayNum(start) > 6) return setFormErr('The date window can cover at most 7 days.');
    if (!Number.isInteger(rc) || rc < 1 || rc > pol.maxRecordCap) return setFormErr(`Record budget must be a whole number from 1 to ${pol.maxRecordCap}.`);
    if (!Number.isInteger(qc2) || qc2 < 8 || qc2 > pol.maxRequestCap) return setFormErr(`Request budget must be a whole number from 8 to ${pol.maxRequestCap}.`);
    if (!Number.isInteger(mt) || mt < 1 || mt > pol.maxRecordCap) return setFormErr(`Number of matching dockets must be a whole number from 1 to ${pol.maxRecordCap}.`);
    if (mt > rc) return setFormErr(`The processing safety cap (${rc}) is below the number of matches wanted (${mt}). Raise it under advanced details, up to ${pol.maxRecordCap}.`);
    if (collectMonetary && (upper == null || upper < 1 || upper > 2147483647)) return setFormErr('Enter a positive monetary upper bound in whole cents, such as 500.00.');
    create.mutate(
      { data: { courtOffice: 'CP-05-02-Crim', eventType: 'Bail Hearing', startDate: start, endDate: end,
        recordCap: rc, requestCap: qc2, matchTarget: mt,
        matchFilters: { monetaryUpperBoundCents: collectMonetary ? upper : null, excludeShownPosted: collectPosted, inclusiveMaximum: true } } },
      {
        onSuccess: (j) => { setJobId(j.id); setSelectedCandidateIds([]); setCandidateMsg(null); setCtlMsg(null); refreshJob(j.id); },
        onError: (er) => setFormErr(errMsg(er)),
      },
    );
  }

  function act(action: DiscoveryControlAction) {
    if (!selected) return;
    setCtlMsg(null);
    control.mutate({ jobId: selected, data: { action } }, {
      onSuccess: () => { setCtlMsg(`${action} accepted. Existing results and the original budget are kept.`); refreshJob(selected); },
      onError: (er) => { setCtlMsg(`${action} failed: ${errMsg(er)}`); refreshJob(selected); },
    });
  }

  function doSave(itemId: string, entryIndex: number | null) {
    setSaveErr(null);
    save.mutate({ jobId: selected, itemId, data: { entryIndex } }, {
      onSuccess: () => {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/records') });
        refreshJob(selected);
      },
      onError: (er) => setSaveErr({ id: itemId, msg: `Not saved: ${errMsg(er)}` }),
    });
  }

  function toggleCandidate(itemId: string, checked: boolean) {
    setSelectedCandidateIds((current) => checked
      ? current.includes(itemId) ? current : [...current, itemId]
      : current.filter((id) => id !== itemId));
  }

  function selectVisibleCandidates() {
    const visibleIds = matching.filter(canSaveCandidate).map((item) => item.id);
    setSelectedCandidateIds((current) => [...new Set([...current, ...visibleIds])]);
  }

  function saveSelectedCandidates() {
    if (!selected || !selectedCandidateIds.length) return;
    setCandidateMsg(null);
    saveCandidates.mutate({ jobId: selected, data: { itemIds: selectedCandidateIds } }, {
      onSuccess: (result) => {
        setSelectedCandidateIds([]);
        setCandidateMsg(`Saved ${result.docketCount} docket${result.docketCount === 1 ? '' : 's'} and ${result.observationCount} source-backed observation${result.observationCount === 1 ? '' : 's'} as candidates.`);
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/records') });
        refreshJob(selected);
      },
      onError: (er) => {
        setCandidateMsg(`Selected dockets were not saved: ${errMsg(er)}`);
        refreshJob(selected);
      },
    });
  }

  const estimatedRequests = Number.isInteger(tgtNum) && tgtNum > 0 ? tgtNum + (pol?.calendarRequestAllowance ?? 8) : null;
  const localCapReached = !!job && job.processed >= job.criteria.recordCap && job.unprocessed > 0;
  const sourceFailed = !!job && (job.status === 'FAILED' || job.failedRequests > 0);
  const active = job?.status === 'QUEUED' || job?.status === 'RUNNING';

  return (
    <Shell>
      <PageHead label="Search" title="Search court records">
        Begin starts a bounded job on the server that reads public court pages and reports what it found. Results are provisional observations, not custody status and not an operative order. Nothing is saved until you choose an entry or select dockets to save together. Looking for records already saved here? <Link href="/candidates" className="underline text-primary" data-testid="link-research">Open saved candidates</Link>.
      </PageHead>

      <section className="panel mb-8" aria-labelledby="scope-h" data-testid="section-scope">
        <h2 id="scope-h" className="mono text-xl font-bold mb-2">Source status</h2>
        {policy.isLoading ? <div className="skel h-16" aria-busy="true" /> : policy.isError ? (
          <div className="errbox" role="alert"><p>Could not load discovery policy. {errMsg(policy.error)}</p>
            <button type="button" className="btn btn-danger mt-3" onClick={() => policy.refetch()} data-testid="button-retry-policy">Retry</button></div>
        ) : pol ? (
          <div className="space-y-2">
            <p>Court: <span className="mono font-semibold">CP-05-02-Crim</span> (Common Pleas). Event: <span className="mono font-semibold">Bail Hearing</span>.</p>
            <p className="hint">Not supported yet: Magisterial District Court (MDJ) searches and the Preliminary Arraignment event are unproven, so they are not offered and nothing is substituted for them. History before {pol.minimumDate} is not covered.</p>
            <p className="hint" data-testid="text-coverage">{pol.coverageNote}</p>
            <p className="hint">Current pacing: at least {pol.currentSpacingMs / 1000} seconds after each response finishes, concurrency {pol.concurrency}, automatic retries {pol.automaticRetries}. Protected maxima: {pol.maxRecordCap} processed dockets, {pol.maxRequestCap} requests per job. These safeguards cannot guarantee access or prevent rate limits.</p>
            <p className="mono text-sm" data-testid="text-rolling-budgets">Rolling hour: {pol.hourlyRequestsUsed}/{pol.hourlyRequestCap} requests. Rolling day: {pol.dailyRequestsUsed}/{pol.dailyRequestCap}. Required assets, failed attempts and uncertain transmissions all count.</p>
            <p className="hint" data-testid="text-access-proof">Exact-client proof: {pol.accessVerifiedAt ? `${pol.verifiedMethod}, ${formatInstant(pol.accessVerifiedAt)}` : 'Not verified'}. Broader collection approval: {pol.collectionApprovedAt ? formatInstant(pol.collectionApprovedAt) : 'Not approved'}.</p>
            <p className="hint">Request in flight: {pol.requestInFlight ? 'yes; no next request can start' : 'no'}. Last response duration: {pol.lastLatencyMs === null ? 'not measured' : `${(pol.lastLatencyMs / 1000).toFixed(1)} seconds`}. Throttles observed: {pol.throttleCount}.</p>
            {pol.nextEligibleAt ? <p className="hint" data-testid="text-next-eligible">Earliest timing/quota eligibility: {formatInstant(pol.nextEligibleAt)}. This is not authorization and never resumes a stopped job automatically.</p> : null}
            {pol.latencyWarning ? <p className="errbox" role="status">{pol.latencyWarning}</p> : null}
            {pol.pausedUntil && Date.parse(pol.pausedUntil) > Date.now() ? <p className="errbox" role="status">Source cooldown until {formatInstant(pol.pausedUntil)}. No new requests permitted before then.</p> : null}
            {!pol.collectionEnabled ? <p className="errbox" role="status">Collection is paused source-wide: {pol.blockedReason}. No new court requests will start. Access denial requires operator assessment, not an automatic retry.</p> : null}
            <details className="border border-border rounded p-3" data-testid="details-pilot-status">
              <summary className="mono cursor-pointer font-semibold">Staged verification: preparation is not approval</summary>
              <p className="hint mt-2">Separate approvals are required for one identity-checked PDF, then 3, then 10 at a separate time. Each stage includes the exact browser calendar client and public HTTP PDF client, calendar overhead and fixed dates/budgets. The 10-document stage exceeds current protected limits and needs separate budget approval. Passing a pilot does not enable collection or start the 100-match sample.</p>
              {assessments.isError ? <p className="errbox mt-2">Pilot status could not be loaded.</p> : assessments.isLoading ? <p className="hint">Loading pilot status…</p> : !assessments.data?.length ? <p className="hint mt-2">No scoped pilot prepared or approved. No court request authorized by this implementation.</p> : <ul className="mt-2 space-y-2">{assessments.data.map((pilot) => <li key={pilot.id} className="hint"><strong>{pilot.stage}: {pilot.state}</strong> — {pilot.criteria.startDate} to {pilot.criteria.endDate}; {pilot.criteria.recordCap} documents, {pilot.criteria.requestCap} total requests. {pilot.report?.reason ?? 'No completed access report.'}</li>)}</ul>}
            </details>
          </div>
        ) : null}
      </section>

      <form onSubmit={submit} className="panel mb-8" aria-label="Start a discovery job" data-testid="form-job">
        <h2 className="mono text-xl font-bold mb-3">What are you looking for?</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="lbl" htmlFor="d-start">Start date</label>
            <input id="d-start" type="date" className="field" min={pol?.minimumDate} value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-start" /></div>
          <div><label className="lbl" htmlFor="d-end">End date</label>
            <input id="d-end" type="date" className="field" min={start} max={start ? new Date((dayNum(start) + 6) * 86400000).toISOString().slice(0, 10) : undefined} value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-end" /></div>
          <div><label className="lbl" htmlFor="d-match-bound">Maximum bail amount (dollars)</label>
            <input id="d-match-bound" inputMode="decimal" className="field" disabled={!collectMonetary} value={collectBound} onChange={(e) => setCollectBound(e.target.value)} data-testid="input-collection-bound" /></div>
          <div><label className="lbl" htmlFor="d-target">Number of matching dockets to return (max {pol?.maxRecordCap ?? '...'})</label>
            <input id="d-target" inputMode="numeric" className="field" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="input-match-target" /></div>
        </div>
        <p className="hint mt-3">New matches include recorded monetary TOTAL_BAIL at or below the maximum, including exact equality. Legacy jobs retain their original strict comparison. The window covers at most 7 days and each docket counts once.</p>
        {pol && estimatedRequests ? <p className="hint mt-3" data-testid="text-request-cost">Planning estimate: {pol.calendarRequestAllowance} calendar/asset requests + at least {tgtNum} PDF requests = {estimatedRequests} requests if every PDF matches. Allow at least {Math.ceil((estimatedRequests - 1) * pol.currentSpacingMs / 60_000)} minutes of pacing, plus response time and quota/cooldown waits. Nonmatches may require more PDFs; this is not a guaranteed completion estimate. {estimatedRequests > Number(reqCap) ? 'Your fixed request budget is below this planning estimate; expect a possible target shortfall.' : ''} A 100-match sample may require more than 100 PDFs and is not authorized here.</p> : null}
        <details className="mt-4 border border-border rounded p-4" data-testid="details-advanced">
          <summary className="cursor-pointer mono font-bold text-primary">Advanced details: budgets, court, event, filters</summary>
          <div className="grid gap-4 sm:grid-cols-2 my-4">
            <div><label className="lbl" htmlFor="d-court">Court office</label>
              <select id="d-court" className="field" value="CP-05-02-Crim" onChange={() => undefined} data-testid="select-court"><option value="CP-05-02-Crim">CP-05-02-Crim (Common Pleas)</option></select></div>
            <div><label className="lbl" htmlFor="d-event">Event type</label>
              <select id="d-event" className="field" value="Bail Hearing" onChange={() => undefined} data-testid="select-event"><option value="Bail Hearing">Bail Hearing</option></select></div>
            <div><label className="lbl" htmlFor="d-rc">Processing safety cap (max {pol?.maxRecordCap ?? '...'})</label>
              <input id="d-rc" inputMode="numeric" className="field" value={recCap} onChange={(e) => setRecCap(e.target.value)} data-testid="input-record-cap" /></div>
            <div><label className="lbl" htmlFor="d-qc">Request budget (max {pol?.maxRequestCap ?? '...'})</label>
              <input id="d-qc" inputMode="numeric" className="field" value={reqCap} onChange={(e) => setReqCap(e.target.value)} data-testid="input-request-cap" /></div>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={collectMonetary} onChange={(e) => setCollectMonetary(e.target.checked)} data-testid="checkbox-collection-monetary" /> Require monetary total bail at or below the maximum amount</label>
          <label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={collectPosted} onChange={(e) => setCollectPosted(e.target.checked)} data-testid="checkbox-collection-posted" /> Exclude dockets explicitly showing a posted entry</label>
          <p className="hint mt-3">Filters are evaluated locally after extraction and stay fixed for this job. Any recorded monetary TOTAL_BAIL entry may qualify; this is not a current operative-order finding. Unknown or nonmonetary amounts never count as zero. An unknown posted state is not excluded and does not prove custody.</p>
          <p className="hint mt-2">The matching target is separate from the processing and request caps. The worker goes one docket at a time and stops when the target is reached, calendar results run out, or a cap is reached. Source failures pause collection. The target is not guaranteed and dates or budgets never expand automatically. Only Common Pleas Bail Hearing is supported; MDJ and Preliminary Arraignment searches are not offered.</p>
        </details>
        {formErr ? <p className="errbox mt-3" role="alert" data-testid="text-form-error">{formErr}</p> : null}
        <button type="submit" className="btn btn-primary mt-4" disabled={!pol?.collectionEnabled || create.isPending} data-testid="button-start-job">
          {create.isPending ? 'Starting...' : 'Begin'}
        </button>
      </form>

      <section className="mb-8" aria-labelledby="jobs-h">
        <h2 id="jobs-h" className="mono text-xl font-bold mb-3">Jobs</h2>
        {jobs.isLoading ? <div className="skel h-16" aria-busy="true" /> : jobs.isError ? (
          <div className="errbox" role="alert"><p>Could not load jobs. {errMsg(jobs.error)}</p>
            <button type="button" className="btn btn-danger mt-3" onClick={() => jobs.refetch()} data-testid="button-retry-jobs">Retry</button></div>
        ) : (jobs.data?.length ?? 0) === 0 ? (
          <p className="hint border border-dashed border-border rounded p-4" data-testid="empty-jobs">No jobs yet. Start one above; nothing is pre-loaded.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.data!.map((j) => (
              <li key={j.id}>
                <button type="button" className="btn w-full text-left" aria-pressed={j.id === selected} onClick={() => { setJobId(j.id); setSelectedCandidateIds([]); setCandidateMsg(null); }} data-testid={`button-job-${j.id}`}>
                  <span className="mono font-semibold">{j.status}</span> &middot; {j.criteria.startDate} to {j.criteria.endDate} &middot; {j.processed}/{j.discovered} processed &middot; {j.matching}{j.criteria.matchTarget ? `/${j.criteria.matchTarget}` : ''} matching &middot; created {formatInstant(j.createdAt)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section aria-labelledby="rep-h" data-testid="section-report">
          <div className="bracket mb-1">Results</div>
          <h2 id="rep-h" className="mono text-xl font-bold mb-3">Search results</h2>
          {report.isLoading ? <div className="space-y-3" aria-busy="true"><div className="skel h-24" /><div className="skel h-24" /></div>
          : report.isError ? (
            <div className="errbox" role="alert"><p>Could not load this job. {errMsg(report.error)}</p>
              <button type="button" className="btn btn-danger mt-3" onClick={() => report.refetch()} data-testid="button-retry-report">Retry</button></div>
          ) : job ? (
            <>
              <div className="panel mb-6" role="status" aria-live="polite">
                <p className="mono font-bold text-lg" data-testid="text-job-status">{job.status}</p>
                <p>{job.criteria.courtOffice}, {job.criteria.eventType}, {job.criteria.startDate} to {job.criteria.endDate}. Started {formatInstant(job.createdAt)}; updated {formatInstant(job.updatedAt)}.</p>
                {job.message ? <p className="mt-1" data-testid="text-job-message">{job.message}</p> : null}
                <p className="hint mt-2" data-testid="text-fixed-filters">{job.criteria.matchTarget
                  ? `Fixed collection target: ${job.criteria.matchTarget} matching dockets. Monetary bound: ${job.criteria.matchFilters?.monetaryUpperBoundCents != null ? `${job.criteria.matchFilters.inclusiveMaximum ? 'at or below' : 'strictly under'} ${formatCents(job.criteria.matchFilters.monetaryUpperBoundCents)}` : 'off'}. Exclude shown-posted: ${job.criteria.matchFilters?.excludeShownPosted ? 'yes' : 'no'}.`
                  : 'Legacy job: processing budget only; no matching target was selected. Its original criteria have not been changed.'}</p>
                {job.criteria.matchTarget && !job.targetReached && job.status === 'COMPLETED' ? <p className="hint text-warning" data-testid="text-target-shortfall">Target not reached: {job.matching} of {job.criteria.matchTarget}. Collection stopped within the original scope and safety limits.</p> : null}
                {job.resultsExpiredAt ? <ExpiredResultsNotice resultsExpiredAt={job.resultsExpiredAt} items={items} /> : job.resultsExpireAt ? <p className="hint mt-2">Unsaved stopped-search results expire {formatInstant(job.resultsExpireAt)}. Save source-backed observations before then; saved candidates are retained.</p> : null}
                {active ? <p className="hint mt-1">Working. This tab refreshes every {POLL_MS / 1000} seconds until the job stops; refreshing pauses if the tab is in the background.</p> : null}
                <button type="button" className="btn mt-2" disabled={report.isFetching} onClick={() => report.refetch()} data-testid="button-refresh">{report.isFetching ? 'Refreshing...' : 'Refresh now'}</button>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  {([
                    ['Requests made', `${job.requestsUsed} of ${job.criteria.requestCap} cap`],
                    ['Requests completed', job.completedRequests], ['Requests failed', job.failedRequests],
                    ['Record cap', job.criteria.recordCap],
                    ['Discovered', job.discovered], ['Processed', job.processed],
                    ['Matching (fixed filters)', job.matching], ['Target', job.criteria.matchTarget ?? 'legacy job'],
                    ['Failed', job.failed], ['Unprocessed', job.unprocessed],
                  ] as const).map(([l, v]) => (
                    <div key={l} className="border border-border rounded p-2"><dt className="mono text-sm">{l}</dt><dd className="mono text-lg font-bold">{v}</dd></div>
                  ))}
                </dl>
                <ul className="hint mt-3 list-disc pl-5">
                  <li>Calendar table: {job.calendarComplete ? 'a returned calendar table was validated. This does not prove every docket in the window was listed.' : 'not validated; the calendar may not have been read, so results can be missing.'}</li>
                  <li>Pagination: {job.paginationComplete ? 'complete for the pages read' : 'incomplete; more results may exist'}.</li>
                  <li>Source result cap: {job.resultCapReached ? 'reached; the source stopped returning results, so more dockets may exist' : 'not reached'}.</li>
                  <li>Local processing cap ({job.criteria.recordCap} records): {localCapReached ? `reached with ${job.unprocessed} discovered docket${job.unprocessed === 1 ? '' : 's'} left unprocessed` : 'not reached with unprocessed work remaining'}.</li>
                </ul>
                <div className="flex flex-wrap gap-2 mt-4">
                  {active ? <button type="button" className="btn" disabled={control.isPending} onClick={() => act('PAUSE')} data-testid="button-pause">Pause</button> : null}
                  <ResumeControl job={job} pending={control.isPending} collectionEnabled={!!pol?.collectionEnabled} onResume={() => act('RESUME')} />
                  {active || job.status === 'PAUSED' ? <button type="button" className="btn btn-danger" disabled={control.isPending} onClick={() => act('CANCEL')} data-testid="button-cancel">Cancel</button> : null}
                </div>
                <p className="hint mt-2">Pause, cancel and resume keep results already found and the original budget. Resume can fail during a source cooldown, or with a conflict (409) when the budget or cap is already used up.</p>
                {ctlMsg ? <p className="mt-2" role="status" data-testid="text-control-message">{ctlMsg}</p> : null}
              </div>

              <div className="panel mb-6" data-testid="section-filter">
                <h3 className="mono font-bold mb-2">Provisional local filters</h3>
                <p className="hint mb-3">Computed in your browser. They are not reviewed operative ranges. These display filters are independent and never change the job’s fixed matching filters or target.</p>
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={postedOff} onChange={(e) => setPostedOff(e.target.checked)} data-testid="checkbox-exclude-posted" /> Exclude rows where a posted entry is shown (SHOWN_POSTED)</label>
                    <p className="hint">Off by default. UNKNOWN is never treated as not posted and stays visible. Posted state does not verify custody.</p>
                  </div>
                  <div>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={filterOn} onChange={(e) => setFilterOn(e.target.checked)} data-testid="checkbox-filter" /> Only rows with a monetary total bail strictly below</label>
                    <div className="mt-2"><label className="lbl" htmlFor="bound">Dollar upper bound</label>
                      <input id="bound" inputMode="decimal" className="field max-w-xs" value={bound} onChange={(e) => setBound(e.target.value)} aria-invalid={filterOn && boundCents == null} data-testid="input-bound" /></div>
                    <p className="hint">Uses only entries in the Monetary category with basis Total bail amount and a whole-cent amount. Unknown, missing, unpriced, nonmonetary, nominal and unsecured entries are not treated as zero; they are excluded from this comparison and nominal and unsecured stay separate categories. Enabling this does not exclude posted rows.</p>
                  </div>
                </div>
                {filterOn && boundCents == null ? <p className="errbox mt-3" role="alert">Enter a dollar amount such as 500 or 500.00. The amount filter is not applied.</p> : null}
                <p className="mt-3" data-testid="text-match-count">{anyFilter ? `${matching.length} of ${items.length} rows pass the active filters.` : `Showing all ${items.length} rows; no filters active.`}</p>
                <div className="mt-4 border-t border-border pt-4" data-testid="bulk-candidate-selection">
                  <p className="hint">Select identity-checked dockets to save every extracted bail observation together. Existing review statuses are kept.</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <button type="button" className="btn" onClick={selectVisibleCandidates} disabled={!matching.some(canSaveCandidate)} data-testid="button-select-visible-candidates">Select eligible visible dockets</button>
                    <span className="mono text-sm">{selectedCandidateIds.length} selected</span>
                    <button type="button" className="btn btn-primary" onClick={saveSelectedCandidates} disabled={!selectedCandidateIds.length || saveCandidates.isPending} data-testid="button-save-selected-candidates">
                      {saveCandidates.isPending ? 'Saving candidates…' : 'Save selected as candidates'}
                    </button>
                  </div>
                  {candidateMsg ? <p className={candidateMsg.startsWith('Selected dockets were not saved') ? 'errbox mt-3' : 'mt-3'} role="status" data-testid="text-candidate-save-result">{candidateMsg}</p> : null}
                </div>
              </div>

              {matching.length > 0 ? (
                <div className="overflow-x-auto mb-6" data-testid="table-summary-wrap">
                  <table className="w-full text-left text-sm min-w-[56rem]" data-testid="table-summary">
                    <caption className="text-left mono font-bold mb-2">Results summary ({matching.length} row{matching.length === 1 ? '' : 's'}, source order)</caption>
                    <thead className="mono"><tr className="border-b-2 border-border">
                      <th scope="col" className="p-2">Pos.</th><th scope="col" className="p-2">Docket</th><th scope="col" className="p-2">Court</th><th scope="col" className="p-2">Event date</th>
                      <th scope="col" className="p-2">Bail entries</th><th scope="col" className="p-2">Posted state</th><th scope="col" className="p-2">Extraction</th><th scope="col" className="p-2">Verification</th><th scope="col" className="p-2">Evidence</th>
                    </tr></thead>
                    <tbody>
                      {matching.map((it) => (
                        <tr key={it.id} className="border-b border-border align-top" data-testid={`summary-row-${it.id}`}>
                          <td className="p-2 mono">{it.position + 1}</td>
                          <td className="p-2 mono font-semibold break-all">{it.docketNumber}</td>
                          <td className="p-2">{it.provenance.courtOffice}</td>
                          <td className="p-2">{it.provenance.eventDate ?? 'Not recorded'}</td>
                          <td className="p-2">{it.provenance.entries.length === 0 ? <span className="hint">None extracted</span> : (
                            <ol className="space-y-1">{it.provenance.entries.map((e, i) => <li key={i}>{CATEGORY_LABEL[e.bailCategory]}{e.financialBasis ? ` / ${BASIS_LABEL[e.financialBasis]}` : ''}: <span className="mono">{amountText(e)}</span></li>)}</ol>)}</td>
                          <td className="p-2">{it.provenance.postedEntryState}</td>
                          <td className="p-2">{it.provenance.extractionOutcome}</td>
                          <td className="p-2">{it.savedObservations.length === 0 ? 'Not saved' : (
                            <ul className="space-y-1">{it.savedObservations.map((o) => <li key={o.recordId}>{o.entryIndex == null ? 'No bail section' : `Entry ${o.entryIndex + 1}`}: {VERIF[o.reviewStatus]}</li>)}</ul>)}</td>
                          <td className="p-2"><a className="underline text-primary" href={`#item-${it.id}`}>Details</a><br /><a className="underline text-primary" href={it.sourceUrl} target="_blank" rel="noopener noreferrer">Source docket</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {items.length === 0 && job.resultsExpiredAt ? null : items.length === 0 ? (
                <p className="hint border border-dashed border-border rounded p-4" data-testid="empty-items">{active ? 'No dockets found yet.' : sourceFailed ? 'No records were retrieved: the source failed or requests failed. This says nothing about whether dockets exist.' : !job.calendarComplete ? 'No records were retrieved and the calendar table was not validated, so this may be a barrier rather than an empty calendar.' : 'The validated calendar table returned no matching dockets for this window and event.'}</p>
              ) : matching.length === 0 ? (
                <p className="hint border border-dashed border-border rounded p-4" data-testid="empty-matches">No rows match the current filter. Turn it off to see every row.</p>
              ) : (
                <ul className="space-y-4">
                  {matching.map((it) => (
                    <ItemRow key={it.id} jobId={selected} it={it} saving={save.isPending} onSave={doSave} err={saveErr?.id === it.id ? saveErr.msg : null}
                      selected={selectedCandidateIds.includes(it.id)} onSelect={toggleCandidate} />
                  ))}
                </ul>
              )}

              {(report.data?.events.length ?? 0) > 0 ? (
                <details className="mt-6">
                  <summary className="cursor-pointer mono font-semibold text-primary">Job event log ({report.data!.events.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {report.data!.events.map((ev, i) => <li key={i} className="hint"><span className="mono">{formatInstant(ev.createdAt)}</span> {ev.kind}: {ev.message}</li>)}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}
