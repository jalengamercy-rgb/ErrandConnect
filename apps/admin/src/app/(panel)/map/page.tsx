'use client';

import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import type { LiveMapData } from '@/components/live-map';
import { MAP_LEGEND } from '@/components/map-colors';
import { api } from '@/lib/api';

// Leaflet needs the browser's window, so load the map only on the client.
const LiveMap = dynamic(() => import('@/components/live-map'), { ssr: false, loading: () => <Loading /> });

export default function MapPage() {
  const { data, error } = useQuery({
    queryKey: ['/admin/live-map'],
    queryFn: () => api.get<LiveMapData>('/admin/live-map'),
    refetchInterval: 10_000,
  });
  return (
    <>
      <PageHeader
        title="Live map"
        subtitle={
          data ? `${data.runners.length} runners online · ${data.orders.length} active errands · refreshes every 10 seconds` : undefined
        }
      />
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        {MAP_LEGEND.map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} /> {label}
          </span>
        ))}
      </div>
      <ErrorBox error={error} />
      {data && <LiveMap data={data} />}
    </>
  );
}
