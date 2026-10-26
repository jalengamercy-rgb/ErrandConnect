import { describe, expect, it } from 'vitest';
import { estimateRoadKm, isForwardMove } from './orders';

describe('isForwardMove', () => {
  it('allows moving forward, including skipping steps', () => {
    expect(isForwardMove('ACCEPTED', 'AT_STORE')).toBe(true);
    expect(isForwardMove('ACCEPTED', 'IN_TRANSIT')).toBe(true);
  });

  it('rejects going backwards, staying put, or leaving a final state', () => {
    expect(isForwardMove('PICKED_UP', 'AT_STORE')).toBe(false);
    expect(isForwardMove('PICKED_UP', 'PICKED_UP')).toBe(false);
    expect(isForwardMove('CANCELLED', 'IN_TRANSIT')).toBe(false);
  });
});

describe('estimateRoadKm', () => {
  it('adds 30% to the straight-line distance', () => {
    // CBD to Westlands is about 2.2 km in a straight line.
    expect(estimateRoadKm({ lat: -1.2864, lng: 36.8172 }, { lat: -1.2676, lng: 36.8108 })).toBe(2.9);
  });
});
