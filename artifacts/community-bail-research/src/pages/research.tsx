import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import {
  useListBailRecords,
  useGetBailRange,
  getListBailRecordsQueryKey,
  getGetBailRangeQueryKey,
  type ListBailRecordsParams,
  type GetBailRangeParams,
  type BailCategory,
  type BailRecord,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { EvidenceDetails, StatusTag } from '@/components/record-bits';
import { BASIS_LABEL, CATEGORY_LABEL, COURT_LABEL, errMsg, formatCents, formatInstant } from '@/lib/money';

type Basis = NonNullable<GetBailRangeParams['financialBasis']>;

type DocketGroup = {
  docketNumber: string;
  county: string;
  courtLevel: BailRecord['courtLevel'];
  records: BailRecord[];
};

function groupByDocket(records: BailRecord[]): DocketGroup[] {
  const groups = new Map<string, DocketGroup>();
  for (const record of records) {
    const key = [record.courtLevel, record.county.trim().toLocaleLowerCase('en-US'), record.docketNumber.trim().toLocaleLowerCase('en-US')].join('|');
    const group = groups.get(key);
    if (group) {
      group.records.push(record);
    } else {
      groups.set(key, {
        docketNumber: record.docketNumber,
        county: record.county,
        courtLevel: record.courtLevel,
        records: [record],
      });
    }
  }

  return Array.from(groups.values(), (group) => ({
    ...group,
    records: [...group.records].sort((a, b) => {
      for (const [left, right] of [
        [a.orderDate, b.orderDate],
        [a.sourceObservedAt, b.sourceObservedAt],
        [a.sourceRetrievedAt, b.sourceRetrievedAt],
        [a.createdAt, b.createdAt],
      ]) {
        if (left === right) continue;
        if (left == null) return 1;
        if (right == null) return -1;
        const comparison = left.localeCompare(right);
        if (comparison !== 0) return comparison;
      }
      return a.id.localeCompare(b.id);
    }),
  }));
}

export default function Research({ candidates = false }: { candidates?: boolean } = {}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [court, setCourt] = useState('');
  const [county, setCounty] = useState('');
  const [charge, setCharge] = useState('');
  const [cat, setCat] = useState<BailCategory>('MONETARY');
  const [basis, setBasis] = useState<Basis>('TOTAL_BAIL');
  const [params, setParams] = useState<ListBailRecordsParams>({});

  const range: GetBailRangeParams = {
    financialBasis: basis,
    bailCategory: cat,
    ...(params.courtLevel ? { courtLevel: params.courtLevel } : {}),
    ...(params.county ? { county: params.county } : {}),
    ...(params.chargeGroup ? { chargeGroup: params.chargeGroup } : {}),
  };

  const list = useListBailRecords(params, { query: { queryKey: getListBailRecordsQueryKey(params), refetchOnMount: 'always' } });
  const rangeQ = useGetBailRange(range, { query: { queryKey: getGetBailRangeQueryKey(range), refetchOnMount: 'always' } });

  function submit(e: FormEvent) {
    e.preventDefault();
    const p: ListBailRecordsParams = {};
    if (q.trim()) p.query = q.trim();
    if (status) p.reviewStatus = status as ListBailRecordsParams['reviewStatus'];
    if (court) p.courtLevel = court as ListBailRecordsParams['courtLevel'];
    if (county.trim()) p.county = county.trim();
    if (charge.trim()) p.chargeGroup = charge.trim();
    setParams(p);
  }

  function clear() {
    setQ(''); setStatus(''); setCourt(''); setCounty(''); setCharge(''); setParams({});
  }

  const records = list.data?.records ?? [];
  const docketGroups = candidates ? groupByDocket(records) : [];
  const r = rangeQ.data;
  const hasRange = !!r && r.reviewedRecordCount > 0 && r.medianCents != null;

  return (
    <Shell>
      <PageHead label={candidates ? 'Candidates' : 'Search saved records'} title={candidates ? 'Candidates' : 'Search records'}>
        {candidates ? 'Observations you explicitly saved, with review status shown. Candidates are not recommendations, custody confirmation, or release eligibility. ' : null}Searches only observations already saved in this workspace. It does not contact court sources or search countywide. Names are not searchable.
      </PageHead>

      <div className="panel mb-8" data-testid="panel-discovery-link">
        <p className="mono font-bold">Saved search is not live discovery.</p>
        <p className="hint mt-1">This page only searches what is already saved here. To fetch new court-backed observations from a source, start a bounded job in live discovery.</p>
        <Link href="/discovery" className="btn mt-3" data-testid="link-discovery">Open live discovery</Link>
      </div>

      <form onSubmit={submit} className="panel mb-8" aria-label="Search saved records">
        <label htmlFor="q" className="lbl">Docket number or charge text</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input id="q" className="field" value={q} maxLength={120} onChange={(e) => setQ(e.target.value)} placeholder="Enter a docket number or charge group" data-testid="input-search" />
          <button type="submit" className="btn btn-primary sm:whitespace-nowrap" data-testid="button-search">SEARCH RECORDS</button>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer mono font-semibold text-primary">Refine search</summary>
          <div className="grid gap-4 mt-4 md:grid-cols-2">
            <div>
              <label htmlFor="f-status" className="lbl">Review status</label>
              <select id="f-status" className="field" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-status">
                <option value="">All statuses</option>
                <option value="PENDING">Needs review</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-court" className="lbl">Court level</label>
              <select id="f-court" className="field" value={court} onChange={(e) => setCourt(e.target.value)} data-testid="select-court">
                <option value="">All court levels</option>
                <option value="MDJ">Magisterial District Judge</option>
                <option value="COMMON_PLEAS">Common Pleas</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-county" className="lbl">County</label>
              <input id="f-county" className="field" maxLength={80} value={county} onChange={(e) => setCounty(e.target.value)} data-testid="input-county" />
            </div>
            <div>
              <label htmlFor="f-charge" className="lbl">Charge group</label>
              <input id="f-charge" className="field" maxLength={120} value={charge} onChange={(e) => setCharge(e.target.value)} data-testid="input-charge" />
            </div>
          </div>
          <button type="button" className="btn mt-4" onClick={clear} data-testid="button-clear">Clear search and filters</button>
        </details>
      </form>

      <section className="panel mb-8" aria-labelledby="range-h" data-testid="section-range">
        <div className="bracket mb-1">Descriptive range</div>
        <h2 id="range-h" className="mono text-xl font-bold mb-3">Reviewed operative observations</h2>
        <p className="hint mb-3">Uses only observations confirmed against their source and reviewed as the operative order, as of when each source was consulted. This is not a live or current countywide figure. Categories and bases are never mixed.</p>
        <p className="hint mb-3">Range scope: {params.county || 'all saved counties'}; {params.courtLevel ? COURT_LABEL[params.courtLevel] : 'all court levels'}; {params.chargeGroup || 'all saved charge groups'}. Refine these filters to define a comparison set. Docket/text search and review-status filters apply to the results list only.</p>
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl mb-4">
          <div>
            <label htmlFor="rcat" className="lbl">Bail category (one at a time)</label>
            <select id="rcat" className="field" value={cat} onChange={(e) => setCat(e.target.value as BailCategory)} data-testid="select-range-category">
              {(['MONETARY', 'NOMINAL', 'UNSECURED'] as const).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
            </select>
          </div>
        <div>
          <label htmlFor="basis" className="lbl">Financial basis (one at a time)</label>
          <select id="basis" className="field" value={basis} onChange={(e) => setBasis(e.target.value as Basis)} data-testid="select-basis">
            {Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        </div>
        {rangeQ.isLoading ? (
          <div className="skel h-20" aria-busy="true" aria-label="Loading range" />
        ) : rangeQ.isError ? (
          <div className="errbox" role="alert">
            <p>Could not load the range. {errMsg(rangeQ.error)}</p>
            <button type="button" className="btn btn-danger mt-3" onClick={() => rangeQ.refetch()} data-testid="button-retry-range">Retry</button>
          </div>
        ) : hasRange && r ? (
          <div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[['Minimum', r.minimumCents], ['Median', r.medianCents], ['Maximum', r.maximumCents]].map(([l, v]) => (
                <div key={String(l)} className="border border-border rounded p-3">
                  <div className="mono text-sm">{l}</div>
                  <div className="mono text-xl md:text-2xl font-bold text-primary" data-testid={`text-${String(l).toLowerCase()}`}>{formatCents(v as number)}</div>
                </div>
              ))}
            </div>
            <p className="mt-3" data-testid="text-range-count">Based on {r.reviewedRecordCount} reviewed operative observation{r.reviewedRecordCount === 1 ? '' : 's'}, category: {CATEGORY_LABEL[cat]}, basis: {BASIS_LABEL[basis]}. Evaluated {formatInstant(r.evaluatedAt)}.</p>
            <p className="hint">{r.note}</p>
          </div>
        ) : (
          <div className="border border-dashed border-border rounded p-4" data-testid="empty-range">
            <p className="font-semibold">No range to show.</p>
            <p className="hint">A range appears only after reviewed operative observations exist for this category, basis and filters. Nothing is estimated or filled in.</p>
          </div>
        )}
        <p className="hint mt-3">This is a description of past saved observations. It is not a recommendation for any individual case.</p>
      </section>

      <section aria-labelledby="res-h">
        <div className="bracket mb-1">Results</div>
        <h2 id="res-h" className="mono text-xl font-bold mb-3">
          Saved observations{list.data ? ` (${list.data.total})` : ''}
        </h2>
        {list.isLoading ? (
          <div className="space-y-3" aria-busy="true"><div className="skel h-16" /><div className="skel h-16" /><div className="skel h-16" /></div>
        ) : list.isError ? (
          <div className="errbox" role="alert">
            <p>Could not load saved records. {errMsg(list.error)}</p>
            <button type="button" className="btn btn-danger mt-3" onClick={() => list.refetch()} data-testid="button-retry-list">Retry</button>
          </div>
        ) : records.length === 0 ? (
          <div className="panel grid-bg" data-testid="empty-results">
            <div className="bg-card p-4 max-w-2xl">
              <p className="mono font-bold text-lg">No saved records match.</p>
              <p className="mt-2">
                {Object.keys(params).length > 0
                  ? 'Nothing saved matches this search. Try fewer filters.'
                  : 'This workspace is empty. No records have been entered yet, and none are provided for you.'}
              </p>
              <p className="hint mt-2">Records come only from real source evidence you enter and review. No countywide source is searched.</p>
              <Link href="/records/new" className="btn btn-primary mt-4" data-testid="link-enter-first">Enter a source-backed record</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-y-2">
                <thead className="mono text-sm">
                  <tr>
                    {candidates ? null : <><th className="px-3 py-2">Docket</th><th className="px-3 py-2">Court / County</th></>}
                    <th className="px-3 py-2">Charge group</th><th className="px-3 py-2">Bail</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    {candidates ? <th className="px-3 py-2">Order date</th> : null}
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                {candidates ? docketGroups.map((group) => (
                  <tbody key={`${group.courtLevel}|${group.county}|${group.docketNumber}`} data-testid="table-docket-group">
                    <tr className="bg-muted/60">
                      <th colSpan={5} className="px-3 py-3 border border-border rounded text-left">
                        <span className="mono font-bold select-all">{group.docketNumber}</span>
                        <span className="hint ml-3">{COURT_LABEL[group.courtLevel]}, {group.county} County</span>
                        <span className="hint block mt-1">{group.records.length} matching observation{group.records.length === 1 ? '' : 's'}, ordered by court order date</span>
                      </th>
                    </tr>
                    {group.records.map((rec) => (
                      <tr key={rec.id} className="bg-card align-top" data-testid={`row-record-${rec.id}`}>
                        <td className="px-3 py-3 border-y border-l border-border">{rec.chargeGroup ?? 'Charge group not recorded'}</td>
                        <td className="px-3 py-3 border-y border-border">{CATEGORY_LABEL[rec.bailCategory]}{rec.financialBasis ? <><br /><span className="hint">{BASIS_LABEL[rec.financialBasis]}</span></> : null}</td>
                        <td className="px-3 py-3 border-y border-border text-right mono font-semibold">{rec.amountCents != null ? formatCents(rec.amountCents) : 'None'}</td>
                        <td className="px-3 py-3 border-y border-border">{rec.orderDate ?? 'Not recorded'}</td>
                        <td className="px-3 py-3 border-y border-r border-border rounded-r"><StatusTag status={rec.reviewStatus} /><EvidenceDetails r={rec} /></td>
                      </tr>
                    ))}
                  </tbody>
                )) : (
                  <tbody>
                    {records.map((rec) => (
                      <tr key={rec.id} className="bg-card align-top" data-testid={`row-record-${rec.id}`}>
                        <td className="px-3 py-3 border-y border-l border-border rounded-l"><span className="mono font-semibold select-all">{rec.docketNumber}</span></td>
                        <td className="px-3 py-3 border-y border-border">{COURT_LABEL[rec.courtLevel]}<br /><span className="hint">{rec.county} County</span></td>
                        <td className="px-3 py-3 border-y border-border">{rec.chargeGroup}</td>
                        <td className="px-3 py-3 border-y border-border">{CATEGORY_LABEL[rec.bailCategory]}{rec.financialBasis ? <><br /><span className="hint">{BASIS_LABEL[rec.financialBasis]}</span></> : null}</td>
                        <td className="px-3 py-3 border-y border-border text-right mono font-semibold">{rec.amountCents != null ? formatCents(rec.amountCents) : 'None'}</td>
                        <td className="px-3 py-3 border-y border-r border-border rounded-r"><StatusTag status={rec.reviewStatus} /><EvidenceDetails r={rec} /></td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>
            {candidates ? (
              <ul className="md:hidden space-y-4">
                {docketGroups.map((group) => (
                  <li key={`${group.courtLevel}|${group.county}|${group.docketNumber}`} className="panel" data-testid="card-docket-group">
                    <div className="mono font-bold select-all break-all">{group.docketNumber}</div>
                    <p className="hint mt-1">{COURT_LABEL[group.courtLevel]}, {group.county} County · {group.records.length} matching observation{group.records.length === 1 ? '' : 's'}</p>
                    <ol className="mt-3 space-y-3">
                      {group.records.map((rec) => (
                        <li key={rec.id} className="border border-border rounded p-3" data-testid={`card-record-${rec.id}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="mono text-sm font-semibold">Order date: {rec.orderDate ?? 'Not recorded'}</span>
                            <StatusTag status={rec.reviewStatus} />
                          </div>
                          <p className="mt-2">{rec.chargeGroup ?? 'Charge group not recorded'}</p>
                          <p>{CATEGORY_LABEL[rec.bailCategory]}{rec.financialBasis ? ` (${BASIS_LABEL[rec.financialBasis]})` : ''}</p>
                          <p className="mono font-semibold text-right">{rec.amountCents != null ? formatCents(rec.amountCents) : 'None'}</p>
                          <EvidenceDetails r={rec} />
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="md:hidden space-y-3">
                {records.map((rec) => (
                  <li key={rec.id} className="panel" data-testid={`card-record-${rec.id}`}>
                    <div className="mono font-bold select-all break-all">{rec.docketNumber}</div>
                    <div className="my-2"><StatusTag status={rec.reviewStatus} /></div>
                    <p>{COURT_LABEL[rec.courtLevel]}, {rec.county} County</p>
                    <p>{rec.chargeGroup}</p>
                    <p>{CATEGORY_LABEL[rec.bailCategory]}{rec.financialBasis ? ` (${BASIS_LABEL[rec.financialBasis]})` : ''}</p>
                    <p className="mono font-semibold text-right">{rec.amountCents != null ? formatCents(rec.amountCents) : 'None'}</p>
                    <EvidenceDetails r={rec} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
