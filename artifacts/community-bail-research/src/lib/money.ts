/** Parse a dollar decimal string to integer cents exactly. Returns null if invalid. Zero allowed. */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return 'None';
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${whole}.${String(cents % 100).padStart(2, '0')}`;
}

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function errMsg(e: unknown): string {
  const x = e as { message?: string; data?: { error?: string } } | null;
  return x?.data?.error ?? x?.message ?? 'Request failed.';
}

export const COURT_LABEL: Record<string, string> = { MDJ: 'Magisterial District Judge', COMMON_PLEAS: 'Common Pleas' };
export const BASIS_LABEL: Record<string, string> = {
  TOTAL_BAIL: 'Total bail amount',
  CASH_DEPOSIT: 'Cash deposit amount',
  SURETY_BOND: 'Surety bond amount',
  UNSECURED_AMOUNT: 'Unsecured amount',
};
export const CATEGORY_LABEL: Record<string, string> = {
  MONETARY: 'Monetary',
  NOMINAL: 'Nominal',
  UNSECURED: 'Unsecured',
  NONMONETARY: 'Nonmonetary',
  RECOGNIZANCE: 'Recognizance',
  DENIED: 'Bail denied',
  UNKNOWN: 'Unknown',
};
