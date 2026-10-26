'use client';

import { ORDER_STATUS_LABELS, type OrderStatus } from '@errandconnect/shared';
import Link from 'next/link';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import { dateTime, humanize } from '@/lib/format';
import { MAP_COLORS } from './map-colors';

export interface LiveMapData {
  runners: { id: string; name: string; lat: number; lng: number; lastSeenAt: string; deliveryTypes: string[]; busy: boolean }[];
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    runnerId: string | null;
    pickupLat: number | null;
    pickupLng: number | null;
    dropoffLat: number;
    dropoffLng: number;
    category: { name: string };
  }[];
}

const NAIROBI: [number, number] = [-1.2864, 36.8172];

/** OpenStreetMap view of online runners and active errands. Loaded only in the browser. */
export default function LiveMap({ data }: { data: LiveMapData }) {
  return (
    <MapContainer center={NAIROBI} zoom={12} className="h-[70vh] w-full rounded-xl border border-border" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {data.orders.map((o) => {
        const pickup: [number, number] | null = o.pickupLat != null && o.pickupLng != null ? [o.pickupLat, o.pickupLng] : null;
        const dropoff: [number, number] = [o.dropoffLat, o.dropoffLng];
        const popup = (
          <Popup>
            <Link href={`/orders/${o.id}`}>{o.orderNumber}</Link>
            <br />
            {o.category.name} · {ORDER_STATUS_LABELS[o.status]}
          </Popup>
        );
        return (
          <span key={o.id}>
            {pickup && <Polyline positions={[pickup, dropoff]} pathOptions={{ color: MAP_COLORS.pickup, weight: 2, dashArray: '4 6' }} />}
            {pickup && (
              <CircleMarker center={pickup} radius={6} pathOptions={{ color: MAP_COLORS.pickup, fillOpacity: 0.8 }}>
                {popup}
              </CircleMarker>
            )}
            <CircleMarker center={dropoff} radius={6} pathOptions={{ color: MAP_COLORS.dropoff, fillOpacity: 0.8 }}>
              {popup}
            </CircleMarker>
          </span>
        );
      })}
      {data.runners.map((r) => (
        <CircleMarker
          key={r.id}
          center={[r.lat, r.lng]}
          radius={9}
          pathOptions={{ color: r.busy ? MAP_COLORS.busy : MAP_COLORS.free, fillOpacity: 0.9 }}
        >
          <Popup>
            <Link href={`/runners/${r.id}`}>{r.name}</Link>
            <br />
            {r.busy ? 'On a job' : 'Free'} · {r.deliveryTypes.map(humanize).join(', ')}
            <br />
            Seen {dateTime(r.lastSeenAt)}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
