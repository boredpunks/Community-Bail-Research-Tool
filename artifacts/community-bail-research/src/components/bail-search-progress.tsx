import { useEffect, useState } from 'react';
import type { BailSearch } from '@workspace/api-client-react';

function requestLabel(path: string, method: string) {
  if (/case.?search/i.test(path)) return method === 'POST' ? 'Submitting the court calendar search' : 'Loading the court calendar';
  if (path.startsWith('/resource/')) return 'Loading a court calendar resource';
  if (/docket|report/i.test(path)) return 'Retrieving a docket PDF';
  return 'Contacting the court source';
}

function formatElapsed(startedAt: string, now: number) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 'in progress';
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function BailSearchProgressPanel({ search }: { search: BailSearch }) {
  const [now, setNow] = useState(() => Date.now());
  const currentRequest = search.progress.currentRequest;
  const findingCalendar = search.stage !== 'checking_documents';
  const total = search.progress.total;
  const hasDocumentTotal = !findingCalendar && total > 0;
  const completed = hasDocumentTotal ? Math.min(search.progress.completed, total) : 0;
  const percentage = hasDocumentTotal ? Math.round((completed / total) * 100) : null;

  useEffect(() => {
    if (search.status !== 'running' || !currentRequest) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [currentRequest, search.searchId, search.status]);

  const phaseTitle = findingCalendar ? 'Searching and validating the court calendar' : 'Checking docket documents';
  const phaseDetail = findingCalendar
    ? 'The calendar response is not validated yet, so a docket total is not available.'
    : total > 0
      ? `${completed} of ${total} dockets processed; ${search.progress.pending} remain.`
      : 'The calendar stage has ended, but a validated docket total is not available yet.';

  return (
    <section className="mt-3 space-y-3 rounded border border-border bg-card p-4" aria-label="Live search progress" data-testid="panel-search-progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{phaseTitle}</h2>
          <p className="hint mt-1">{phaseDetail}</p>
        </div>
        <span className="hint text-xs">{findingCalendar ? 'Phase 1 of 2' : 'Phase 2 of 2'}</span>
      </div>

      <div
        className="h-2 overflow-hidden rounded bg-primary/15"
        role="progressbar"
        aria-label={findingCalendar ? 'Court calendar search progress' : 'Docket document processing progress'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage ?? undefined}
        aria-valuetext={percentage === null ? 'Waiting for a validated docket total' : `${completed} of ${total} dockets processed`}
      >
        <div
          className={`h-full rounded bg-primary transition-all ${percentage === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percentage === null ? undefined : { width: `${percentage}%` }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <p className="hint">
          Calendar: <strong>{findingCalendar ? 'searching and validating' : 'validated'}</strong>
        </p>
        <p className="hint">
          Dockets processed: <strong>{hasDocumentTotal ? `${completed} / ${total}` : 'not available until calendar validation'}</strong>
        </p>
        {search.progress.sourceRequestLimit !== null ? (
          <p className="hint">
            Source request budget: <strong>{search.progress.sourceRequestsUsed} / {search.progress.sourceRequestLimit}</strong>
            <span className="block text-xs">Includes requests for calendar page assets.</span>
          </p>
        ) : (
          <p className="hint">Source requests used: <strong>{search.progress.sourceRequestsUsed}</strong></p>
        )}
      </div>

      <p className="hint" data-testid="text-search-current-activity">
        {currentRequest
          ? `${requestLabel(currentRequest.path, currentRequest.method)} · ${formatElapsed(currentRequest.startedAt, now)} elapsed`
          : 'No court request is in flight at this instant.'}
      </p>
      {search.reason ? <p className="hint text-xs">Latest server update: {search.reason}</p> : null}
    </section>
  );
}
