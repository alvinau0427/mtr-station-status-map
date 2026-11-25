import { describe, expect, it } from 'vitest';
import { FULL_SCAN_INTERVAL_MS, RYG_CACHE_MS, selectLinesToScan, shouldFetchRyg } from './polling';

const allGreen = Object.fromEntries(
  ['AEL', 'TCL', 'TML', 'TKL', 'EAL', 'SIL', 'TWL', 'ISL', 'KTL', 'DRL'].map((code) => [code, 'green']),
) as Record<string, 'green'>;

describe('selectLinesToScan', () => {
  it('performs a full scan when no previous scan is recorded', () => {
    const plan = selectLinesToScan(allGreen, 1_000_000, null);
    expect(plan.fullScan).toBe(true);
    expect(plan.lines).toHaveLength(10);
  });

  it('skips all station calls when every line is green and no full scan is due', () => {
    const plan = selectLinesToScan(allGreen, 1_000_000, 1_000_000 - 60_000);
    expect(plan.fullScan).toBe(false);
    expect(plan.lines).toEqual([]);
  });

  it('only polls abnormal lines in a normal cycle', () => {
    const plan = selectLinesToScan(
      { ...allGreen, TKL: 'yellow', EAL: 'red', DRL: 'grey' },
      1_000_000,
      1_000_000 - 60_000,
    );
    expect(plan.lines).toEqual(['TKL', 'EAL']);
  });

  it('runs a full scan after the 10-minute interval', () => {
    const plan = selectLinesToScan(allGreen, 1_000_000, 1_000_000 - FULL_SCAN_INTERVAL_MS - 1);
    expect(plan.fullScan).toBe(true);
    expect(plan.lines).toHaveLength(10);
  });

  it('skips grey lines during a forced full scan', () => {
    const plan = selectLinesToScan({ ...allGreen, DRL: 'grey' }, 1_000_000, 1_000_000, true);
    expect(plan.fullScan).toBe(true);
    expect(plan.lines).toHaveLength(9);
    expect(plan.lines).not.toContain('DRL');
  });
});

describe('shouldFetchRyg', () => {
  it('fetches when nothing has been cached', () => {
    expect(shouldFetchRyg(1_000_000, null)).toBe(true);
  });

  it('reuses the feed within the 3-minute window', () => {
    expect(shouldFetchRyg(1_000_000, 1_000_000 - RYG_CACHE_MS + 1_000)).toBe(false);
  });

  it('refetches after the 3-minute window', () => {
    expect(shouldFetchRyg(1_000_000, 1_000_000 - RYG_CACHE_MS - 1)).toBe(true);
  });

  it('always refetches for a forced full scan', () => {
    expect(shouldFetchRyg(1_000_000, 1_000_000, true)).toBe(true);
  });
});
