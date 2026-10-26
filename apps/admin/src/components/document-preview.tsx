'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '@/lib/api';

/** Shows a private uploaded document, loaded with the staff login token. */
export function DocumentPreview({ id, mimeType, alt }: { id: string; mimeType: string; alt: string }) {
  const { data: blob, error } = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.blob(`/documents/${id}/file`),
    staleTime: Infinity,
  });
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  // Free the browser memory for the image when it's no longer shown.
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  if (error) return <div className="text-xs text-danger">Could not load file</div>;
  if (!url) return <div className="h-32 w-full animate-pulse rounded bg-brand-soft" />;
  if (mimeType === 'application/pdf') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand underline">
        Open PDF
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimisable */}
      <img src={url} alt={alt} className="h-40 w-full rounded border border-border object-contain" />
    </a>
  );
}
