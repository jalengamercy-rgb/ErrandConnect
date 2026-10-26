/** Marker colours on the live map (kept separate so the page can show a legend without loading Leaflet). */
export const MAP_COLORS = { free: '#16a34a', busy: '#2563eb', pickup: '#d97706', dropoff: '#dc2626' };

export const MAP_LEGEND: [string, string][] = [
  ['Free runner', MAP_COLORS.free],
  ['Runner on a job', MAP_COLORS.busy],
  ['Pickup', MAP_COLORS.pickup],
  ['Drop-off', MAP_COLORS.dropoff],
];
