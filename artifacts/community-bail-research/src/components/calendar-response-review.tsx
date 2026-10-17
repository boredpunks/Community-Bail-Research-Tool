import React from 'react';

type Props = { message: string };

export function CalendarResponseReview({ message }: Props) {
  const findings = message.split('|');
  if (findings.length !== 4 || findings.some((finding) => !finding.includes(': '))) return null;

  return (
    <section className="panel mb-6" role="status" aria-live="polite" data-testid="calendar-response-findings">
      <h3 className="mono font-bold mb-2">Search response review</h3>
      <dl className="space-y-2">
        {findings.map((finding) => {
          const separator = finding.indexOf(': ');
          return (
            <div key={finding.slice(0, separator)}>
              <dt className="mono font-semibold">{finding.slice(0, separator)}</dt>
              <dd className="hint">{finding.slice(separator + 2)}</dd>
            </div>
          );
        })}
      </dl>
      <p className="hint mt-2">Counts and validation outcomes only; no source text, URLs, docket identifiers, or document content are retained here.</p>
    </section>
  );
}
