export const WORKFLOW_PANELS = [
  { href: '/search', n: '01', title: 'Search', id: 'search', text: 'Search the live court calendar and view the raw results.' },
  {
    href: '/review',
    n: '02',
    title: 'Review',
    id: 'review',
    text: 'Shared Review keeps source-backed matches from all searches until someone deletes them. Extraction is not human confirmation.',
  },
  {
    href: '/candidates',
    n: '03',
    title: 'Candidates',
    id: 'candidates',
    text: 'Rows explicitly saved to the shared Candidates list. Saving does not verify or approve a finding.',
  },
] as const;

export const WORKFLOW_NAV = [
  { href: '/search', label: 'Search', description: undefined },
  { href: '/review', label: 'Review', description: 'Shared queue, retained until deleted' },
  { href: '/candidates', label: 'Candidates', description: 'Rows saved to the shared list' },
] as const;

export const REVIEW_TITLE = 'Shared review queue';
export const REVIEW_DESCRIPTION =
  'Reviewable source-backed matches from all searches stay here until any workspace user deletes them from Review. Extraction is not human confirmation. Saving adds a row to shared Candidates; it does not verify or approve the finding.';

export const CANDIDATES_ACTIVE_DESCRIPTION =
  'Rows explicitly saved to the shared Candidates list. Saving records list membership; it does not verify the source or approve a finding. Mark a reported successful bail-out before archiving.';
export const CANDIDATES_ARCHIVE_DESCRIPTION =
  'Rows explicitly saved to the shared Candidates list remain available here and can be restored. Saving does not verify or approve a finding.';

export const CANDIDATE_SAVE_LABEL = 'Save to Candidates';
export const CANDIDATE_SAVED_LABEL = 'In shared Candidates';
export const CANDIDATE_SAVE_TITLE =
  'Adds this result to the shared Candidates list; it does not verify or approve the finding.';
