import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSchedulesForLines,
  fetchStationSchedule,
  isRateLimited,
  resetRateLimitForTests,
} from './mtrApi';

function scheduleResponse(line = 'TKL', sta = 'TKO') {
  return new Response(JSON.stringify({
    sys_time: '2026-11-24 15:19:59',
    curr_time: '2026-11-24 15:19:59',
    data: {
      [`${line}-${sta}`]: {
        UP: [{ seq: '1', dest: 'POA', plat: '1', time: '2026-11-24 15:20:00', ttnt: '2', valid: 'Y', source: '-' }],
        DOWN: [],
      },
    },
    status: 1,
    message: 'successful',
    isdelay: 'N',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const throttled = () => new Response('', { status: 429, headers: { 'Retry-After': '0.001' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetRateLimitForTests();
});

describe('fetchStationSchedule', () => {
  it('normalises a successful API response', async () => {
    const request = vi.fn().mockResolvedValue(scheduleResponse());
    vi.stubGlobal('fetch', request);

    const result = await fetchStationSchedule('TKL', 'TKO');

    expect(result.status).toBe(1);
    expect(result.isdelay).toBe('N');
    expect(result.up).toHaveLength(1);
    expect(result.up[0].dest).toBe('POA');
    expect(result.down).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries once on HTTP 429', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(scheduleResponse());
    vi.stubGlobal('fetch', request);

    const result = await fetchStationSchedule('TKL', 'TKO');

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(1);
  });

  it('gives up after two throttled responses', async () => {
    const request = vi.fn().mockResolvedValue(throttled());
    vi.stubGlobal('fetch', request);

    await expect(fetchStationSchedule('TKL', 'TKO')).rejects.toThrow('429');
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('fetchSchedulesForLines', () => {
  it('streams an observation for every station on the selected lines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(scheduleResponse('DRL', 'SUN'))));
    const seen: string[] = [];

    const result = await fetchSchedulesForLines(['DRL'], undefined, (observation) => {
      seen.push(`${observation.line}-${observation.code}`);
    });

    expect(result).toEqual({ requested: 2, completed: 2, errors: 0, skipped: 0 });
    expect(seen.sort()).toEqual(['DRL-DIS', 'DRL-SUN']);
  });

  it('trips the breaker after repeated 429s and skips further station requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(throttled()));

    await expect(fetchStationSchedule('TKL', 'TKO')).rejects.toThrow('429');
    expect(isRateLimited()).toBe(true);

    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const seen: string[] = [];
    const result = await fetchSchedulesForLines(['DRL'], undefined, (observation) => {
      seen.push(`${observation.line}-${observation.code}`);
    });

    expect(result).toEqual({ requested: 2, completed: 2, errors: 0, skipped: 2 });
    expect(seen).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
