export const kes = (amount: number | null | undefined) => `KES ${(amount ?? 0).toLocaleString('en-KE')}`;

export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const date = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { dateStyle: 'medium' }) : '—';

/** "UNDER_REVIEW" → "Under review" */
export const humanize = (value: string | null | undefined) => {
  if (!value) return '—';
  const text = value.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const fullName = (p: { firstName: string; lastName: string } | null | undefined) => (p ? `${p.firstName} ${p.lastName}` : '—');
