import type { DiscoveryJob, DiscoveryReport, DiscoveryEntry } from '@workspace/api-client-react';

/** Same-origin URL with the artifact base prefix. */
export function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    throw new ApiError(res.status, `${msg} (HTTP ${res.status})`);
  }
  return body as T;
}

export type DiscoveryOperations = {
  calendarEnabled: boolean;
  calendarBlockedReason: string | null;
  documentEnabled: false;
  documentBlockedReason: string | null;
  pacing: { navigationMs: number; assetMs: number; searchMs: number; documentMs: number };
  notice: string | null;
};

export type SearchInput = {
  courtOffice: string; courtRoom: string; eventType: string;
  startDate: string; endDate: string; scheduledOnly: true;
};

export type LocalUploadResult = { jobId: string; itemId: string; extractionOutcome: string; detail: string | null };

export type LedgerRequest = {
  method: string; path: string; statusCode: number | null; outcome: string;
  startedAt: string | null; completedAt: string | null; durationMs: number | null;
};
export type ReportWithRequests = DiscoveryReport & { requests?: LedgerRequest[] };
export type EntryExt = DiscoveryEntry & {
  originatingCourt?: string | null;
  percentageCondition?: string | null;
  excerpt?: string | null;
};

export const OPERATIONS_KEY = ['/api/discovery/operations'] as const;

export async function getOperations(signal?: AbortSignal): Promise<DiscoveryOperations> {
  return parse(await fetch(apiUrl('/api/discovery/operations'), { credentials: 'include', signal }));
}

export async function postSearch(input: SearchInput): Promise<DiscoveryJob> {
  return parse(await fetch(apiUrl('/api/discovery/searches'), {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}

export async function uploadLocalDocument(file: File, opts: { docketNumber?: string; jobId?: string; itemId?: string }): Promise<LocalUploadResult> {
  const q = new URLSearchParams();
  if (opts.docketNumber?.trim()) q.set('docketNumber', opts.docketNumber.trim());
  if (opts.jobId) q.set('jobId', opts.jobId);
  if (opts.itemId) q.set('itemId', opts.itemId);
  const qs = q.toString();
  return parse(await fetch(apiUrl(`/api/discovery/local-documents${qs ? `?${qs}` : ''}`), {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/pdf' }, body: file,
  }));
}

export function isHttpsPortal(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const value = new URL(url);
    return value.protocol === 'https:' && value.hostname === 'ujsportal.pacourts.us'
      && ['/Report/CpDocketSheet', '/Report/MdjDocketSheet'].includes(value.pathname)
      && !value.username && !value.password;
  } catch { return false; }
}
