import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListVolunteerFeedbackQueryKey,
  useListVolunteerFeedback,
  useSubmitVolunteerFeedback,
} from '@workspace/api-client-react';
import { Shell, PageHead } from '@/components/shell';
import { errMsg, formatInstant } from '@/lib/money';

const QUESTIONS = [
  { key: 'tryingToDo', label: 'What were you trying to do?' },
  { key: 'obstacle', label: 'What got in the way?' },
  { key: 'needed', label: 'What do you need next?' },
] as const;

type Key = typeof QUESTIONS[number]['key'];

export default function Feedback() {
  const qc = useQueryClient();
  const list = useListVolunteerFeedback({ query: { queryKey: getListVolunteerFeedbackQueryKey() } });
  const submit = useSubmitVolunteerFeedback();
  const [values, setValues] = useState<Record<Key, string>>({ tryingToDo: '', obstacle: '', needed: '' });
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSent(false);
    const data = { tryingToDo: values.tryingToDo.trim(), obstacle: values.obstacle.trim(), needed: values.needed.trim() };
    const missing = QUESTIONS.find((q) => !data[q.key]);
    if (missing) { setFormError(`Please answer: ${missing.label}`); return; }
    const tooLong = QUESTIONS.find((q) => data[q.key].length > 2000);
    if (tooLong) { setFormError(`Keep each answer under 2,000 characters (${tooLong.label}).`); return; }
    submit.mutate({ data }, {
      onSuccess: () => {
        setValues({ tryingToDo: '', obstacle: '', needed: '' });
        setSent(true);
        qc.invalidateQueries({ queryKey: getListVolunteerFeedbackQueryKey() });
      },
      onError: (error) => setFormError(`Feedback was not saved: ${errMsg(error)}`),
    });
  }

  const items = list.data ?? [];

  return (
    <Shell>
      <PageHead label="Volunteer feedback" title="Tell us what you actually need">
        Three short questions. All feedback is visible to everyone in this shared workspace. Do not include names, docket numbers, or private contact information.
      </PageHead>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form className="panel space-y-4" onSubmit={onSubmit} noValidate data-testid="form-feedback">
          {QUESTIONS.map((q) => (
            <label key={q.key} className="block">
              <span className="lbl">{q.label}</span>
              <textarea
                className="field"
                rows={3}
                maxLength={2000}
                required
                value={values[q.key]}
                onChange={(event) => setValues((prev) => ({ ...prev, [q.key]: event.target.value }))}
                data-testid={`input-feedback-${q.key}`}
              />
              <span className="hint text-xs">{values[q.key].length}/2000</span>
            </label>
          ))}
          {formError ? <p className="errbox" role="alert" data-testid="error-feedback">{formError}</p> : null}
          {sent ? <p className="bail-complete" role="status" data-testid="status-feedback-sent">Thank you. Your feedback is saved and shown below.</p> : null}
          <button type="submit" className="btn btn-primary" disabled={submit.isPending} data-testid="button-submit-feedback">
            {submit.isPending ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
        <section className="panel" aria-labelledby="feedback-list-heading" data-testid="section-feedback-list">
          <p className="bracket">Shared with the workspace</p>
          <h2 id="feedback-list-heading" className="mono text-xl font-bold">What volunteers have said</h2>
          {list.isLoading ? <div className="mt-4 space-y-2" aria-label="Loading feedback"><div className="skel h-16" /><div className="skel h-16" /></div> : null}
          {list.isError ? (
            <div className="errbox mt-4" role="alert">
              Feedback could not be loaded. {errMsg(list.error)}
              <button type="button" className="btn mt-3" onClick={() => list.refetch()} data-testid="button-retry-feedback">Retry</button>
            </div>
          ) : null}
          {list.data && items.length === 0 ? <p className="hint mt-4" data-testid="empty-feedback">No feedback yet. Yours will be the first.</p> : null}
          {items.length ? (
            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li key={item.id} className="border border-border p-3" data-testid={`card-feedback-${item.id}`}>
                  <p className="hint text-xs mono">{formatInstant(item.createdAt)}</p>
                  {QUESTIONS.map((q) => (
                    <div key={q.key} className="mt-2">
                      <p className="lbl">{q.label}</p>
                      <p className="whitespace-pre-wrap break-words">{item[q.key]}</p>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
