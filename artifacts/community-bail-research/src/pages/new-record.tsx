import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateBailRecord,
  getListBailRecordsQueryKey,
  getGetBailRangeQueryKey,
  type BailRecordInput,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { BASIS_LABEL, CATEGORY_LABEL, errMsg, parseDollarsToCents } from '@/lib/money';

const empty = {
  docketNumber: '', county: '', courtLevel: 'MDJ', chargeGroup: '', bailCategory: 'UNKNOWN',
  financialBasis: '', amount: '', orderDate: '', sourceTitle: '', sourceUrl: '', retrievedAt: '', observedAt: '', evidenceNote: '',
};

export default function NewRecord() {
  const qc = useQueryClient();
  const create = useCreateBailRecord();
  const [f, setF] = useState(empty);
  const [attest, setAttest] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedDocket, setSavedDocket] = useState<string | null>(null);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const moneyApplies = ['MONETARY', 'NOMINAL', 'UNSECURED'].includes(f.bailCategory);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSavedDocket(null);
    const errs: string[] = [];
    if (!f.docketNumber.trim()) errs.push('Docket number is required.');
    if (!f.county.trim()) errs.push('County is required.');
    if (!f.chargeGroup.trim()) errs.push('Charge group is required.');
    if (!f.sourceTitle.trim()) errs.push('Source title is required.');
    if (!f.evidenceNote.trim()) errs.push('Evidence note is required.');
    try {
      const u = new URL(f.sourceUrl.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') errs.push('Source URL must start with http:// or https://.');
    } catch {
      errs.push('A valid source URL is required.');
    }
    let cents: number | null = null;
    let basis: BailRecordInput['financialBasis'] = null;
    if (moneyApplies) {
      basis = (f.financialBasis || null) as BailRecordInput['financialBasis'];
      if (f.amount.trim()) {
        cents = parseDollarsToCents(f.amount);
        if (cents != null && cents > 2147483647) { errs.push('Amount is too large. The maximum is $21,474,836.47.'); cents = null; }
        else if (cents == null) errs.push('Amount must be dollars with at most two decimal places, for example 1500 or 1500.50.');
        if (!f.financialBasis) errs.push('Choose the financial basis for this amount.');
        else basis = f.financialBasis as BailRecordInput['financialBasis'];
      }
    }
    let retrieved = '';
    if (!f.retrievedAt) errs.push('Enter the date and time you actually consulted the source.');
    else {
      const d = new Date(f.retrievedAt);
      if (Number.isNaN(d.getTime())) errs.push('Source-consulted date and time is not valid.');
      else if (d.getTime() > Date.now()) errs.push('Source-consulted time cannot be in the future.');
      else retrieved = d.toISOString();
    }
    if (!attest) errs.push('You must attest that this record comes from a real source you consulted.');
    let observed: string | null = null;
    if (f.observedAt) {
      const d = new Date(f.observedAt);
      if (Number.isNaN(d.getTime())) errs.push("The source's own timestamp is not valid; correct it or leave it unknown.");
      else observed = d.toISOString();
    }
    setErrors(errs);
    if (errs.length) return;
    const data: BailRecordInput = {
      docketNumber: f.docketNumber.trim(),
      county: f.county.trim(),
      courtLevel: f.courtLevel as BailRecordInput['courtLevel'],
      chargeGroup: f.chargeGroup.trim(),
      bailCategory: f.bailCategory as BailRecordInput['bailCategory'],
      financialBasis: moneyApplies ? basis : null,
      amountCents: cents,
      orderDate: f.orderDate || null,
      sourceTitle: f.sourceTitle.trim(),
      sourceUrl: f.sourceUrl.trim(),
      sourceRetrievedAt: retrieved,
      sourceObservedAt: observed,
      realRecordAttestation: true,
      evidenceNote: f.evidenceNote.trim(),
    };
    create.mutate({ data }, {
      onSuccess: (rec) => {
        setSavedDocket(rec.docketNumber);
        setF(empty);
        setAttest(false);
        qc.invalidateQueries({ queryKey: getListBailRecordsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBailRangeQueryKey() });
      },
    });
  }

  return (
    <Shell>
      <PageHead label="Manual entry" title="Enter a source-backed observation">
        Enter only what a real, linkable court source shows. The record is saved as Needs review and never counts toward a range until its evidence is confirmed and its order is reviewed as operative.
      </PageHead>

      <div className="notice mb-6" data-testid="notice-must-be-real">
        <div className="bracket mb-1">Records must be real</div>
        <p>Do not enter invented, example, or test dockets. There are no sample records in this workspace, and none should be created.</p>
      </div>

      {savedDocket ? (
        <div className="panel mb-6" role="status" data-testid="status-saved">
          <p className="font-semibold">Saved docket <span className="mono">{savedDocket}</span> as Needs review.</p>
          <p className="hint">It is excluded from ranges until reviewed.</p>
          <Link href="/review" className="btn mt-3" data-testid="link-go-review">Open review queue</Link>
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="errbox mb-6" role="alert" data-testid="errors-form">
          <p className="font-semibold">Fix these before saving:</p>
          <ul className="list-disc pl-5">{errors.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {create.isError ? (
        <div className="errbox mb-6" role="alert">
          <p>Could not save. {errMsg(create.error)}</p>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-6" noValidate>
        <fieldset className="panel grid gap-4 md:grid-cols-2">
          <legend className="bracket px-2">Docket</legend>
          <div><label className="lbl" htmlFor="docket">Docket number</label><input id="docket" className="field mono" maxLength={80} value={f.docketNumber} onChange={set('docketNumber')} data-testid="input-docket" /></div>
          <div><label className="lbl" htmlFor="county">County</label><input id="county" className="field" maxLength={80} value={f.county} onChange={set('county')} data-testid="input-county" /></div>
          <div><label className="lbl" htmlFor="court">Court level</label>
            <select id="court" className="field" value={f.courtLevel} onChange={set('courtLevel')} data-testid="select-court">
              <option value="MDJ">Magisterial District Judge</option><option value="COMMON_PLEAS">Common Pleas</option>
            </select></div>
          <div><label className="lbl" htmlFor="charge">Charge group</label><input id="charge" className="field" maxLength={120} value={f.chargeGroup} onChange={set('chargeGroup')} data-testid="input-charge" /></div>
          <div><label className="lbl" htmlFor="odate">Order date (optional)</label><input id="odate" type="date" className="field" value={f.orderDate} onChange={set('orderDate')} data-testid="input-order-date" /></div>
        </fieldset>

        <fieldset className="panel grid gap-4 md:grid-cols-2">
          <legend className="bracket px-2">Bail as shown in the source</legend>
          <div className="md:col-span-2"><label className="lbl" htmlFor="cat">Bail category</label>
            <select id="cat" className="field" value={f.bailCategory} onChange={set('bailCategory')} data-testid="select-category">
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {moneyApplies ? (
            <>
              <div><label className="lbl" htmlFor="basis">Financial basis (required for a known amount)</label>
                <select id="basis" className="field" value={f.financialBasis} onChange={set('financialBasis')} data-testid="select-basis">
                  <option value="">Choose a basis</option>
                  {Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><label className="lbl" htmlFor="amount">Amount in dollars (leave blank if unknown)</label>
                <input id="amount" inputMode="decimal" className="field mono" value={f.amount} onChange={set('amount')} placeholder="0.00" data-testid="input-amount" />
                <p className="hint">Up to two decimal places. Zero is allowed.</p></div>
            </>
          ) : (
            <p className="hint md:col-span-2">No amount or basis applies to this category and none will be saved.</p>
          )}
        </fieldset>

        <fieldset className="panel grid gap-4 md:grid-cols-2">
          <legend className="bracket px-2">Source evidence</legend>
          <div><label className="lbl" htmlFor="stitle">Source title</label><input id="stitle" className="field" maxLength={160} value={f.sourceTitle} onChange={set('sourceTitle')} data-testid="input-source-title" /></div>
          <div><label className="lbl" htmlFor="surl">Source URL</label><input id="surl" type="url" className="field" maxLength={2000} value={f.sourceUrl} onChange={set('sourceUrl')} placeholder="https://" data-testid="input-source-url" /></div>
          <div><label className="lbl" htmlFor="ret">Source consulted at (required)</label><input id="ret" type="datetime-local" className="field" value={f.retrievedAt} onChange={set('retrievedAt')} data-testid="input-retrieved" /><p className="hint">The date and time you actually looked at the source. Not filled in for you.</p></div>
          <div><label className="lbl" htmlFor="obs">Source's own "as of" time (optional)</label><input id="obs" type="datetime-local" className="field" value={f.observedAt} onChange={set('observedAt')} data-testid="input-observed" /></div>
          <div className="md:col-span-2"><label className="lbl" htmlFor="note">Evidence note</label>
            <textarea id="note" className="field" maxLength={4000} value={f.evidenceNote} onChange={set('evidenceNote')} data-testid="input-evidence" />
            <p className="hint">Use the minimum excerpt needed to support these fields. Omit personal names, dates of birth, addresses, and private credentials. Unknown amounts must stay blank, not zero.</p>
            <p className="hint">Say where in the source the bail information appears so a reviewer can find it.</p></div>
        </fieldset>

        <div className="panel">
          <label className="flex gap-3 items-start cursor-pointer">
            <input type="checkbox" className="mt-1.5 h-5 w-5 shrink-0" checked={attest} onChange={(e) => setAttest(e.target.checked)} data-testid="checkbox-attest" />
            <span>I attest this is a real record from a real source that I consulted myself, and that the details above match what the source showed. It is not invented, an example, or a test.</span>
          </label>
        </div>

        <button type="submit" className="btn btn-primary" disabled={create.isPending} data-testid="button-save-record">
          {create.isPending ? 'Saving record...' : 'SAVE AS NEEDS REVIEW'}
        </button>
      </form>
    </Shell>
  );
}
