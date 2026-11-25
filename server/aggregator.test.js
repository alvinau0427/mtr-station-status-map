import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAggregator, parseRygXml, parseSchedule } from './aggregator.js';

const LINES = JSON.parse(readFileSync(new URL('../shared/lines.json', import.meta.url), 'utf8'));
const totalPairs = LINES.reduce((sum, line) => sum + line.stations.length, 0);
const rygXml = `\uFEFF${LINES.map((line) => (
  `<line><line_code>${line.code}</line_code><status>green</status></line>`
)).join('')}`;

const okResponse = (text) => ({ ok: true, status: 200, text: async () => text });
const throttled = () => ({
  ok: false,
  status: 429,
  headers: { get: () => '0.001' },
  text: async () => '',
});

function makeFetch(stationHandler) {
  const calls = [];
  const fetchImpl = vi.fn(async (url) => {
    calls.push(url);
    if (url.includes('ryg_line_status')) return okResponse(rygXml);
    const { searchParams } = new URL(url);
    const line = searchParams.get('line');
    const sta = searchParams.get('sta');
    return stationHandler(line, sta);
  });
  return { fetchImpl, calls };
}

const fastAggregator = (fetchImpl) => createAggregator({
  fetchImpl,
  sleepImpl: async () => {},
  requestSpacingMs: 0,
  cycleMs: 3_600_000,
});

describe('parseRygXml', () => {
  it('strips the BOM and reads line codes and statuses', () => {
    expect(parseRygXml(`\uFEFF<line><line_code>TKL</line_code><status>yellow</status></line>`))
      .toEqual({ TKL: 'yellow' });
  });
});

describe('parseSchedule', () => {
  it('normalises arrivals for the requested line/station', () => {
    const payload = JSON.stringify({
      status: 1,
      message: 'ok',
      isdelay: 'Y',
      data: { 'TKL-TKO': { UP: [{ ttnt: '3', dest: 'POA' }], DOWN: [] } },
    });
    const result = parseSchedule(payload, 'TKL', 'TKO');
    expect(result.status).toBe(1);
    expect(result.isdelay).toBe('Y');
    expect(result.up).toEqual([{
      ttnt: '3', dest: 'POA', valid: '', plat: '', time: '', source: '', seq: '',
    }]);
  });
});

describe('aggregator', () => {
  it('scans every pair on the first cycle and serves a complete snapshot', async () => {
    const { fetchImpl, calls } = makeFetch((line, sta) => okResponse(JSON.stringify({
      status: 1,
      message: 'ok',
      isdelay: 'N',
      data: { [`${line}-${sta}`]: { UP: [], DOWN: [] } },
    })));
    const aggregator = fastAggregator(fetchImpl);

    await aggregator.runCycle();
    const snapshot = aggregator.getSnapshot();

    expect(snapshot.observations).toHaveLength(totalPairs);
    expect(snapshot.scan).toEqual({ done: totalPairs, total: totalPairs });
    expect(snapshot.lastFullScanAt).not.toBeNull();
    expect(calls).toHaveLength(totalPairs + 1);
  });

  it('skips station requests when all lines are green and nothing is incomplete', async () => {
    const { fetchImpl, calls } = makeFetch((line, sta) => okResponse(JSON.stringify({
      status: 1, message: 'ok', isdelay: 'N', data: { [`${line}-${sta}`]: {} },
    })));
    const aggregator = fastAggregator(fetchImpl);

    await aggregator.runCycle();
    const afterFullScan = calls.length;
    await aggregator.runCycle();

    expect(calls.length).toBe(afterFullScan);
    expect(aggregator.getSnapshot().lastPlan).toContain('略過站點查詢');
  });

  it('repairs a failed station on the next cycle without a full sweep', async () => {
    let failures = 2;
    const { fetchImpl, calls } = makeFetch((line, sta) => {
      if (line === 'DRL' && sta === 'DIS' && failures > 0) {
        failures -= 1;
        return { ok: false, status: 500, text: async () => '' };
      }
      return okResponse(JSON.stringify({
        status: 1, message: 'ok', isdelay: 'N', data: { [`${line}-${sta}`]: {} },
      }));
    });
    const aggregator = fastAggregator(fetchImpl);

    await aggregator.runCycle();
    expect(aggregator.getSnapshot().observations).toHaveLength(totalPairs);
    expect(aggregator.getSnapshot().observations.find((o) => o.code === 'DIS' && o.line === 'DRL').error)
      .toBe('HTTP 500');

    const before = calls.length;
    await aggregator.runCycle();
    expect(calls.length - before).toBeGreaterThan(0);
    expect(calls.length - before).toBeLessThan(totalPairs);
    expect(aggregator.getSnapshot().observations.find((o) => o.code === 'DIS' && o.line === 'DRL').api)
      .toBeDefined();
  });

  it('refresh only re-fetches RYG when everything is already complete', async () => {
    const { fetchImpl, calls } = makeFetch((line, sta) => okResponse(JSON.stringify({
      status: 1, message: 'ok', isdelay: 'N', data: { [`${line}-${sta}`]: {} },
    })));
    const aggregator = fastAggregator(fetchImpl);
    await aggregator.runCycle();
    const before = calls.length;

    const res = { writeHead: vi.fn(), end: vi.fn() };
    aggregator.handleRefresh({}, res);
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(res.end).toHaveBeenCalled();
    expect(calls.length - before).toBe(1);
    expect(calls.at(-1)).toContain('ryg_line_status');
  });

  it('ignores repeated action requests inside the minimum interval', async () => {
    const { fetchImpl, calls } = makeFetch((line, sta) => okResponse(JSON.stringify({
      status: 1, message: 'ok', isdelay: 'N', data: { [`${line}-${sta}`]: {} },
    })));
    const aggregator = fastAggregator(fetchImpl);
    await aggregator.runCycle();
    const res = { writeHead: vi.fn(), end: vi.fn() };

    aggregator.handleFullScan({}, res);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    const afterFirst = calls.length;

    aggregator.handleFullScan({}, res);
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(afterFirst).toBeGreaterThan(1);
    expect(calls.length).toBe(afterFirst);
    expect(aggregator.getSnapshot().lastPlan).toContain('請稍候');
  });

  it('gzip-compresses the snapshot when the client accepts gzip', () => {
    const { fetchImpl } = makeFetch(() => okResponse(''));
    const aggregator = fastAggregator(fetchImpl);
    const res = { writeHead: vi.fn(), end: vi.fn() };

    aggregator.handleSnapshot({ headers: { 'accept-encoding': 'gzip, deflate' } }, res);

    const headers = res.writeHead.mock.calls[0][1];
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(headers.Vary).toBe('Accept-Encoding');
    expect(Buffer.isBuffer(res.end.mock.calls[0][0])).toBe(true);
  });

  it('keeps every observation and trips a short breaker when throttled', async () => {
    const { fetchImpl, calls } = makeFetch(() => throttled());
    const aggregator = fastAggregator(fetchImpl);

    await aggregator.runCycle();
    const snapshot = aggregator.getSnapshot();

    expect(snapshot.observations).toHaveLength(totalPairs);
    expect(snapshot.observations.every((o) => Boolean(o.error))).toBe(true);
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.scan).toEqual({ done: totalPairs, total: totalPairs });
    // One station retried once, then the breaker stopped the rest of the queue.
    expect(calls.filter((url) => url.includes('getSchedule.php'))).toHaveLength(2);
  });
});
