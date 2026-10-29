import { useState } from 'react';
import { useResumeBailSearch, useStartBailSearch } from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { errMsg } from '@/lib/money';
import { formatInstant } from '@/lib/money';
import { money, safeSourceUrl, shortDate, useLatestSearch, usePromoteSearch } from '@/lib/latest-search';

const LIVE_OFFICES = [
  { value: 'ANY', label: 'Any supported office' },
  { value: 'CP-05-02-Crim', label: 'Common Pleas criminal' },
] as const;
const LIVE_EVENTS = ['Formal Arraignment', 'Preliminary Hearing', 'Bail Hearing', 'Preliminary Arraignment'] as const;
type Office = (typeof LIVE_OFFICES)[number]['value'];
type LiveEvent = (typeof LIVE_EVENTS)[number];

function todayNewYork() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export default function BailSearch() {
  const { run, status } = useLatestSearch();
  const promote = usePromoteSearch();
  const started = useStartBailSearch();
  const resume = useResumeBailSearch();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxBail, setMaxBail] = useState('2000');
  const [courtOffice, setCourtOffice] = useState<Office>('ANY');
  const [eventType, setEventType] = useState<LiveEvent>('Bail Hearing');
  const [formError, setFormError] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const amount = maxBail.trim() ? Number(maxBail) : NaN;
    if (!startDate || !endDate) return setFormError('Choose both hearing dates.');
    if (endDate < startDate) return setFormError('End date must be on or after start date.');
    const today = todayNewYork();
    if (startDate < today) return setFormError(`Hearing start must be today or later (${today}).`);
    if (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`) > 6 * 86_400_000) return setFormError('A search can cover at most seven days.');
    if (!Number.isFinite(amount) || amount < 0 || amount > 20_000_000) return setFormError('Enter a maximum bail from $0 to $20,000,000.');
    started.mutate({ data: { startDate, endDate, maxBail: amount, source: 'live', courtOffice, eventType } }, {
      onSuccess: (result) => promote(result),
      onError: (error) => setFormError(`Search not started. Previous results are unchanged. ${errMsg(error)}`),
    });
  }

  const recovery = run?.recovery;
  const availableAt = recovery?.availableAt ?? run?.resumeAvailableAt;
  const waiting = availableAt ? Date.parse(availableAt) > Date.now() : false;
  const canResume = run?.status === 'paused' && !!run.resumeToken
    && (!recovery || recovery.action === 'resume' || recovery.action === 'wait');
  const rows = run?.results ?? [];

  return (
    <Shell>
      <PageHead label="Search" title="Live court search" />
      <form className="panel space-y-4 max-w-2xl" onSubmit={submit} noValidate data-testid="form-bail-search">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="lbl">Hearing start</span>
            <input className="field" type="date" value={startDate} min={todayNewYork()} onChange={(e) => setStartDate(e.target.value)} data-testid="input-search-start-date" />
          </label>
          <label className="block">
            <span className="lbl">Hearing end</span>
            <input className="field" type="date" value={endDate} min={startDate || todayNewYork()} onChange={(e) => setEndDate(e.target.value)} data-testid="input-search-end-date" />
          </label>
          <label className="block">
            <span className="lbl">Maximum bail (USD)</span>
            <input className="field" type="number" inputMode="decimal" min="0" max="20000000" step="0.01" value={maxBail} onChange={(e) => setMaxBail(e.target.value)} data-testid="input-max-bail" />
          </label>
        </div>
        <details>
          <summary className="cursor-pointer mono text-sm text-primary" data-testid="toggle-search-settings">Settings</summary>
          <div className="grid gap-4 sm:grid-cols-2 mt-3">
            <label className="block">
              <span className="lbl">Court office</span>
              <select className="field" value={courtOffice} onChange={(e) => setCourtOffice(e.target.value as Office)} data-testid="select-search-office">
                {LIVE_OFFICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="lbl">Calendar event</span>
              <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value as LiveEvent)} data-testid="select-search-event">
                {LIVE_EVENTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>
        </details>
        {formError ? <p className="errbox" role="alert" data-testid="error-search-form">{formError}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={started.isPending} data-testid="button-start-bail-search">
          {started.isPending ? 'Starting…' : 'Search'}
        </button>
      </form>

      <section className="mt-8" aria-label="Results" data-testid="section-search-results">
        {status.isLoading ? <p className="hint" role="status">Loading latest results…</p> : null}
        {status.isError ? <p className="errbox" role="alert">Status unavailable. {errMsg(status.error)} <button className="btn" type="button" onClick={() => status.refetch()}>Retry</button></p> : null}
        {run ? (
          <div className="mb-3 space-y-2">
            <p className="hint" data-testid="status-search">
              {run.status === 'running' ? 'Running' : run.status === 'paused' ? 'Paused' : 'Complete'}
              {run.progress.total > 0 ? ` · ${run.progress.completed}/${run.progress.total} checked` : ''}
              {' · '}{shortDate(run.criteria.startDate)} to {shortDate(run.criteria.endDate)} · max {money(run.criteria.maxBail)}
            </p>
            {run.status === 'paused' && (recovery?.message || run.reason) ? <p className="notice" role="status" data-testid="text-recovery-message">{recovery?.message || run.reason}</p> : null}
            {run.status === 'running' && run.reason ? <p className="hint" role="status">{run.reason}</p> : null}
            {canResume ? (
              <button type="button" className="btn" disabled={waiting || resume.isPending} data-testid="button-resume-search"
                onClick={() => run.resumeToken && resume.mutate({ searchId: run.searchId, data: { resumeToken: run.resumeToken } }, { onSuccess: promote })}>
                {resume.isPending ? 'Resuming…' : waiting ? 'Resume available soon' : 'Resume'}
              </button>
            ) : null}
            {resume.isError ? <p className="errbox" role="alert">Resume failed: {errMsg(resume.error)}</p> : null}
          </div>
        ) : null}
        {run && !status.isLoading && !status.isError && rows.length === 0 ? <p className="hint">{run.status === 'running' ? 'Waiting for rows…' : run.incomplete ? 'No rows yet. This search is incomplete.' : 'No rows returned.'}</p> : null}
        {rows.length ? (
          <div className="bail-compare-scroll">
            <table className="bail-compare-table" style={{ minWidth: 0 }} data-testid="table-search-rows">
              <thead><tr><th>#</th><th>Docket</th><th>Date</th><th>Bail</th><th>Evidence</th></tr></thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id} data-testid={`row-search-${row.id}`}>
                    <td className="mono">{i + 1}</td>
                    <th className="mono break-all">{row.docket_number}</th>
                    <td>{shortDate(row.hearing_date)}</td>
                    <td className="mono">{money(row.bail_amount) || (row.classification === 'nonmonetary' ? 'Nonmonetary' : '')}</td>
                    <td>
                      <details data-testid={`details-search-evidence-${row.id}`}>
                        <summary className="cursor-pointer mono text-xs text-primary">Inspect</summary>
                        <div className="min-w-64 space-y-1 py-2">
                          <p className="hint">Evidence page: {row.evidence_page ?? 'Not recorded'}</p>
                          <blockquote>{row.evidence_quote || 'No evidence quote was captured.'}</blockquote>
                          <p className="hint">Acquisition: {row.evidence_acquisition || 'Not recorded'}</p>
                          <p className="hint">Original PDF retrieval: {row.source_retrieved_at ? formatInstant(row.source_retrieved_at) : 'Not recorded'}</p>
                          <p className="hint">Local document consultation: {row.source_consulted_at ? formatInstant(row.source_consulted_at) : 'Not recorded'}</p>
                          {row.source_pdf_sha256 ? <p className="hint break-all">Verified PDF SHA-256: {row.source_pdf_sha256}</p> : null}
                          {safeSourceUrl(row.source_url) ? (
                            <a href={safeSourceUrl(row.source_url)!} target="_blank" rel="noopener noreferrer" className="navlink">
                              Open source document
                            </a>
                          ) : <p className="hint">Source document link unavailable.</p>}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </Shell>
  );
}
