import type { Address } from './types';

export function formatAddress(a: Pick<Address, 'building' | 'unit' | 'street' | 'area' | 'city'>) {
  return [a.unit && a.building ? `${a.unit}, ${a.building}` : a.building, a.street, a.area, a.city].filter(Boolean).join(', ');
}

/** "MOTORCYCLE" → "Motorcycle", "SMARTPHONE_ANDROID" → "Smartphone android" */
export function humanize(value: string) {
  const text = value.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
