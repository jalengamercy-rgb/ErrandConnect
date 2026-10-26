import { describe, expect, it } from 'vitest';
import {
  areaCell,
  churnRisk,
  defaultEtaModel,
  fitEtaModel,
  fitLinear,
  forecastFromHistory,
  isoWeekKey,
  isRunningLate,
  predictMinutes,
  riskScore,
  runnersNeeded,
} from './insights';

describe('delivery time', () => {
  it('fits a straight line', () => {
    expect(
      fitLinear([
        { x: 0, y: 10 },
        { x: 2, y: 14 },
        { x: 4, y: 18 },
      ]),
    ).toEqual({ intercept: 10, slope: 2 });
    expect(fitLinear([{ x: 1, y: 5 }])).toBeNull();
  });

  it('uses typical speeds until there is enough history', () => {
    const model = fitEtaModel('MOTORCYCLE', [{ distanceKm: 3, minutes: 30 }]);
    expect(model).toEqual(defaultEtaModel('MOTORCYCLE'));
    expect(predictMinutes(model, 5)).toBe(32);
  });

  it('learns from completed errands and ignores outliers', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ distanceKm: i % 10, minutes: 15 + 3 * (i % 10) }));
    history.push({ distanceKm: 1, minutes: 900 });
    const model = fitEtaModel('BICYCLE', history);
    expect(model).toEqual({ intercept: 15, perKm: 3, samples: 20 });
    expect(predictMinutes(model, 4)).toBe(27);
  });

  it('calls an errand late only when clearly over', () => {
    expect(isRunningLate(30, 38)).toBe(false);
    expect(isRunningLate(30, 41)).toBe(true);
    expect(isRunningLate(10, 14)).toBe(false);
  });
});

describe('demand', () => {
  it('weights recent weeks more', () => {
    expect(forecastFromHistory([])).toBe(0);
    expect(forecastFromHistory([4, 4, 4])).toBe(4);
    expect(forecastFromHistory([6, 0])).toBe(4);
  });

  it('converts errands to runners and points to areas', () => {
    expect(runnersNeeded(0)).toBe(0);
    expect(runnersNeeded(4)).toBe(3);
    expect(areaCell(-1.2864, 36.8172)).toEqual(areaCell(-1.281, 36.811));
    expect(areaCell(-1.2864, 36.8172).key).not.toBe(areaCell(-1.2676, 36.8108).key);
  });
});

describe('churn', () => {
  it('compares time since the last errand with the usual gap', () => {
    expect(churnRisk(5, 3, 4)).toEqual({ risk: 'ACTIVE', ratio: 0.4 });
    expect(churnRisk(5, 20, 7)).toEqual({ risk: 'AT_RISK', ratio: 2.9 });
    expect(churnRisk(1, 60, null)).toEqual({ risk: 'LIKELY_LOST', ratio: 4.3 });
    expect(churnRisk(10, 120, 30).risk).toBe('LOST');
  });
});

describe('risk', () => {
  it('scores by severity and how far over the limit', () => {
    expect(riskScore('LOW')).toBe(20);
    expect(riskScore('HIGH', 3)).toBe(100);
  });

  it('names ISO weeks', () => {
    expect(isoWeekKey(new Date('2026-10-26T10:00:00Z'))).toBe('2026-W44');
    expect(isoWeekKey(new Date('2027-01-01T10:00:00Z'))).toBe('2026-W53');
  });
});
