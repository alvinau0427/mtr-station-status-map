import { describe, expect, it } from 'vitest';
import { findJourney, getAffectedStations, searchStations } from './journey';
import type { StatusResult } from './status';

const result = (status: StatusResult['status']): StatusResult => ({
  status,
  labelTc: status,
  labelEn: status,
});

describe('findJourney', () => {
  it('finds a same-line journey', () => {
    const journey = findJourney('CEN', 'TSW');
    expect(journey).not.toBeNull();
    expect(journey!.segments).toHaveLength(1);
    expect(journey!.segments[0].line).toBe('TWL');
    expect(journey!.stations[0]).toBe('CEN');
    expect(journey!.stations.at(-1)).toBe('TSW');
  });

  it('finds a journey with an interchange', () => {
    const journey = findJourney('CHW', 'POA');
    expect(journey).not.toBeNull();
    expect(journey!.segments.length).toBeGreaterThanOrEqual(2);
    expect(journey!.stations[0]).toBe('CHW');
    expect(journey!.stations.at(-1)).toBe('POA');
    // Every consecutive pair must be connected by a line.
    for (let i = 1; i < journey!.stations.length; i += 1) {
      const line = journey!.segments.find((s) => s.stations.includes(journey!.stations[i]))!;
      expect(line.stations).toContain(journey!.stations[i - 1]);
    }
  });

  it('handles same origin and destination', () => {
    expect(findJourney('CEN', 'CEN')!.stops).toBe(0);
  });

  it('returns null for unknown stations', () => {
    expect(findJourney('XXX', 'CEN')).toBeNull();
  });
});

describe('getAffectedStations', () => {
  it('keeps only stations with a disruptive status', () => {
    const journey = findJourney('CEN', 'ADM')!;
    const results = Object.fromEntries(journey.stations.map((code, i) => [code, result(i === 1 ? 'delay' : 'normal')]));
    const affected = getAffectedStations(journey, results);
    expect(affected).toHaveLength(1);
    expect(affected[0].result.status).toBe('delay');
  });
});

describe('searchStations', () => {
  it('matches Chinese, English and station codes', () => {
    expect(searchStations('中環').some((s) => s.code === 'CEN')).toBe(true);
    expect(searchStations('central').some((s) => s.code === 'CEN')).toBe(true);
    expect(searchStations('TKO').some((s) => s.code === 'TKO')).toBe(true);
  });
});
