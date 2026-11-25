import { describe, expect, it } from 'vitest';
import {
  combineStatuses,
  inferStatus,
  maxHeadway,
  type StationApiResponse,
  type StationObservation,
} from './status';

const api = (overrides: Partial<StationApiResponse> = {}): StationApiResponse => ({
  status: 1,
  message: 'successful',
  isdelay: 'N',
  up: [{ time: '2026-01-01 12:00:00', dest: 'POA', plat: '1', ttnt: '2', seq: '1', valid: 'Y', source: '-' }],
  down: [{ time: '2026-01-01 12:03:00', dest: 'NOP', plat: '2', ttnt: '5', seq: '1', valid: 'Y', source: '-' }],
  ...overrides,
});

const obs = (overrides: Partial<StationObservation> = {}): StationObservation => ({
  code: 'TKO',
  line: 'TKL',
  api: api(),
  fetchedAt: '2026-01-01T12:00:00Z',
  ...overrides,
});

describe('inferStatus', () => {
  it('reports normal service when trains are present and isdelay is N', () => {
    expect(inferStatus(obs(), undefined).status).toBe('normal');
  });

  it('treats line-level grey as non-service hours', () => {
    expect(inferStatus(obs(), 'grey').status).toBe('non-service');
  });

  it('maps a suspended station to disruption', () => {
    const result = inferStatus(obs({ api: api({ status: 0, message: 'LOW station is suspended' }) }), undefined);
    expect(result.status).toBe('disruption');
  });

  it('maps special arrangements with a URL to special-arrangement', () => {
    const result = inferStatus(obs({
      api: api({
        status: 0,
        message: 'Special train service arrangements are now in place on this line.',
        url: 'https://www.mtr.com.hk/alert/alert_title_wap.html',
      }),
    }), undefined);
    expect(result.status).toBe('special-arrangement');
    expect(result.url).toBeTruthy();
  });

  it('treats isdelay=Y with no trains as data-unavailable, not disruption', () => {
    const result = inferStatus(obs({ api: api({ isdelay: 'Y', up: [], down: [], currTime: '-' }) }), undefined);
    expect(result.status).toBe('data-unavailable');
  });

  it('treats isdelay=Y with trains as delay', () => {
    expect(inferStatus(obs({ api: api({ isdelay: 'Y' }) }), undefined).status).toBe('delay');
  });

  it('falls back to line-level red when station data is missing', () => {
    expect(inferStatus(undefined, 'red').status).toBe('disruption');
  });

  it('reports fetch errors', () => {
    expect(inferStatus(obs({ api: undefined, error: 'HTTP 500' }), undefined).status).toBe('error');
  });

  it('treats a successful response with no trains as no-trains, not a data error', () => {
    const result = inferStatus(obs({
      api: api({ isdelay: 'N', up: [], down: [], message: 'successful' }),
    }), undefined);
    expect(result.status).toBe('no-trains');
    expect(result.labelTc).toBe('目前無班次');
  });

  it('shows stale observations as neutral and keeps the last known status in the detail', () => {
    const result = inferStatus(obs({ stale: true }), undefined);
    expect(result.status).toBe('unknown');
    expect(result.labelTc).toBe('資料過期');
    expect(result.stale).toBe(true);
    expect(result.detail).toContain('上次已知狀態：服務正常');
  });
});

describe('combineStatuses', () => {
  it('keeps the worst status for an interchange station', () => {
    const normal = inferStatus(obs(), undefined);
    const disruption = inferStatus(obs({ api: api({ status: 0, message: 'station suspended' }) }), undefined);
    expect(combineStatuses([normal, disruption]).status).toBe('disruption');
  });
});

describe('maxHeadway', () => {
  it('computes the largest gap between train minutes', () => {
    expect(maxHeadway([
      { time: '', dest: '', plat: '', ttnt: '1', seq: '1', valid: 'Y', source: '-' },
      { time: '', dest: '', plat: '', ttnt: '4', seq: '2', valid: 'Y', source: '-' },
      { time: '', dest: '', plat: '', ttnt: '15', seq: '3', valid: 'Y', source: '-' },
    ])).toBe(11);
  });
});

// Keep a reference to the total number of line/station pairs documented by the API.
export const EXPECTED_MIN_STATIONS = 98;
