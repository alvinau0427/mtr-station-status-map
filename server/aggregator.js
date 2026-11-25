/**
 * Server-side snapshot aggregator.
 *
 * Owns the single source of truth for station observations: it refreshes the
 * upstream APIs at a low, steady rate, keeps the last good payload for each
 * station, and exposes one in-memory snapshot to every client. Clients never
 * call the per-station API themselves, so throttling and first-load latency
 * are no longer multiplied by the number of visitors.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LINES = JSON.parse(readFileSync(new URL('../shared/lines.json', import.meta.url), 'utf8'));
const LINE_BY_CODE = Object.fromEntries(LINES.map((line) => [line.code, line]));

const RYG_URL = 'https://tnews.mtr.com.hk/alert/ryg_line_status.xml';
const SCHEDULE_URL = 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php';
const USER_AGENT = 'mtr-station-status-map/1.0.0';

const keyOf = (line, code) => `${line}-${code}`;
const iso = (timestamp) => new Date(timestamp).toISOString();

/** Parse the RYG feed, including the UTF-8 BOM sent by the upstream server. */
export function parseRygXml(text) {
  const xml = text.replace(/^\uFEFF/, '');
  const result = {};
  const pattern = /<line>([\s\S]*?)<\/line>/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const code = /<line_code>([\s\S]*?)<\/line_code>/.exec(match[1])?.[1]?.trim();
    const status = /<status>([\s\S]*?)<\/status>/.exec(match[1])?.[1]?.trim();
    if (code && ['green', 'yellow', 'red', 'grey'].includes(status)) result[code] = status;
  }
  return result;
}

/** Convert one Next Train response into the shape used by the UI. */
export function parseSchedule(text, line, code) {
  const payload = JSON.parse(text);
  if (typeof payload?.status !== 'number') throw new Error('Invalid schedule payload');
  const slot = payload.data?.[`${line}-${code}`] ?? {};
  const arrival = (value) => ({
    ttnt: value?.ttnt ?? '',
    valid: value?.valid ?? '',
    plat: value?.plat ?? '',
    time: value?.time ?? '',
    source: value?.source ?? '',
    dest: value?.dest ?? '',
    seq: value?.seq ?? '',
  });
  return {
    status: payload.status,
    message: payload.message ?? '',
    isdelay: payload.isdelay,
    url: payload.url,
    currTime: payload.curr_time,
    up: (Array.isArray(slot.UP) ? slot.UP : []).map(arrival),
    down: (Array.isArray(slot.DOWN) ? slot.DOWN : []).map(arrival),
  };
}

export function createAggregator(options = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    nowImpl = () => Date.now(),
    requestSpacingMs = 500,
    retryWaitMs = 1_500,
    breakerMinMs = 30_000,
    rygTtlMs = 180_000,
    fullScanMs = 10 * 60_000,
    cycleMs = 5_000,
    refreshMinIntervalMs = 10_000,
    fullScanMinIntervalMs = 60_000,
  } = options;

  const observations = new Map();
  let lineStatuses = {};
  let fetchedAt = null;
  let lastFullScanAt = null;
  let rygFetchedAt = null;
  let lastPlan = '準備中';
  let scan = { done: 0, total: 0 };
  let degradedUntil = 0;
  let queue = [];
  let forceFull = false;
  let forceRyg = false;
  let lastActionAt = { refresh: 0, 'full-scan': 0 };
  let running = false;
  let cycleInFlight = false;
  let timer = null;

  function getSnapshot() {
    return {
      observations: [...observations.values()],
      lineStatuses,
      fetchedAt,
      lastFullScanAt,
      scan: { ...scan },
      lastPlan,
      degraded: nowImpl() < degradedUntil,
    };
  }

  function retryAfterMs(header) {
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 800;
  }

  async function fetchStation(line, code) {
    const url = `${SCHEDULE_URL}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(code)}&lang=TC`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        });
        if (response.status === 429) {
          if (attempt === 0) {
            await sleepImpl(Math.min(retryAfterMs(response.headers?.get?.('retry-after')), retryWaitMs));
            continue;
          }
          const error = new Error('HTTP 429 (rate limited)');
          error.status = 429;
          error.retryAfter = response.headers?.get?.('retry-after');
          throw error;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseSchedule(await response.text(), line, code);
      } catch (error) {
        if (attempt === 0 && error.status !== 429) {
          await sleepImpl(400);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Fetch failed');
  }

  function tripBreaker(error) {
    const seconds = Number(error.retryAfter);
    const upstreamWait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
    degradedUntil = Math.max(nowImpl() + breakerMinMs, nowImpl() + upstreamWait);
  }

  /** Keep the snapshot complete when throttled: never drop a station into "loading". */
  function markThrottled(pairs) {
    for (const { line, code } of pairs) {
      const key = keyOf(line, code);
      const previous = observations.get(key);
      observations.set(key, previous?.api
        ? { ...previous, stale: true, error: 'throttled' }
        : {
          line,
          code,
          error: 'throttled',
          stale: Boolean(previous),
          fetchedAt: previous?.fetchedAt ?? iso(nowImpl()),
        });
    }
  }

  async function ensureRyg() {
    const forced = forceRyg;
    forceRyg = false;
    if (!forced && Object.keys(lineStatuses).length > 0 && nowImpl() - rygFetchedAt < rygTtlMs) return;
    const response = await fetchImpl(RYG_URL, {
      headers: { Accept: 'text/xml', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`RYG feed HTTP ${response.status}`);
    const parsed = parseRygXml(await response.text());
    if (Object.keys(parsed).length === 0) throw new Error('Invalid or empty RYG XML');
    lineStatuses = parsed;
    rygFetchedAt = nowImpl();
  }

  function isLineIncomplete(code) {
    for (const station of LINE_BY_CODE[code].stations) {
      const observation = observations.get(keyOf(code, station));
      if (!observation || observation.stale || observation.error || !observation.api) return true;
    }
    return false;
  }

  function planLines() {
    const active = LINES.filter((line) => lineStatuses[line.code] !== 'grey').map((line) => line.code);
    const full = forceFull
      || lastFullScanAt === null
      || nowImpl() - lastFullScanAt >= fullScanMs;
    forceFull = false;
    if (full) {
      lastFullScanAt = nowImpl();
      return { lines: active, full: true };
    }
    const lines = active.filter((code) => (
      lineStatuses[code] === 'yellow'
      || lineStatuses[code] === 'red'
      || isLineIncomplete(code)
    ));
    return { lines, full: false };
  }

  function enqueue(lines, full) {
    const priority = (line) => (
      lineStatuses[line] === 'red' ? 0 : lineStatuses[line] === 'yellow' ? 1 : 2
    );
    queue = lines
      .flatMap((line) => LINE_BY_CODE[line].stations.map((code) => ({ line, code })))
      .sort((a, b) => priority(a.line) - priority(b.line));
    scan = { done: 0, total: queue.length };
    lastPlan = full
      ? `完整掃描（${lines.length} 條線 / ${queue.length} 站）`
      : queue.length > 0
        ? `更新 ${lines.join(', ')}（${queue.length} 站）`
        : '全線正常 · 略過站點查詢';
  }

  async function processQueue() {
    while (queue.length > 0) {
      await sleepImpl(requestSpacingMs);
      if (nowImpl() < degradedUntil) {
        markThrottled(queue);
        queue = [];
        scan = { done: scan.total, total: scan.total };
        break;
      }
      const { line, code } = queue.shift();
      const key = keyOf(line, code);
      const fetched = iso(nowImpl());
      try {
        const api = await fetchStation(line, code);
        observations.set(key, { line, code, api, fetchedAt: fetched });
      } catch (error) {
        if (error.status === 429) {
          tripBreaker(error);
          markThrottled([{ line, code }, ...queue]);
          queue = [];
          scan = { done: scan.total, total: scan.total };
          break;
        }
        const previous = observations.get(key);
        observations.set(key, previous?.api
          ? { ...previous, stale: true, error: error.message }
          : { line, code, error: error.message, stale: Boolean(previous), fetchedAt: fetched });
      } finally {
        scan = { ...scan, done: Math.min(scan.done + 1, scan.total) };
      }
    }
  }

  async function runCycle() {
    if (cycleInFlight) return;
    cycleInFlight = true;
    try {
      await ensureRyg();
      const { lines, full } = planLines();
      enqueue(lines, full);
      await processQueue();
      fetchedAt = iso(nowImpl());
    } catch (error) {
      lastPlan = `同步失敗：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      cycleInFlight = false;
    }
  }

  function sendJson(req, res, status, body) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      Vary: 'Accept-Encoding',
    };
    const json = JSON.stringify(body);
    const acceptsGzip = /gzip/i.test(req?.headers?.['accept-encoding'] ?? '');
    if (acceptsGzip) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(status, headers);
      res.end(gzipSync(Buffer.from(json)));
      return;
    }
    res.writeHead(status, headers);
    res.end(json);
  }

  /** Reject repeated button presses so they cannot multiply upstream requests. */
  function allowAction(kind, minimumIntervalMs) {
    const now = nowImpl();
    if (now - lastActionAt[kind] < minimumIntervalMs) return false;
    lastActionAt[kind] = now;
    return true;
  }

  return {
    start() {
      if (running) return;
      running = true;
      void runCycle();
      timer = setInterval(() => { void runCycle(); }, cycleMs);
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
    getSnapshot,
    runCycle,
    handleSnapshot(req, res) {
      sendJson(req, res, 200, getSnapshot());
    },
    handleRefresh(req, res) {
      if (allowAction('refresh', refreshMinIntervalMs)) {
        forceRyg = true;
        lastPlan = '已送出更新要求…';
        void runCycle();
      } else {
        lastPlan = '更新要求已送出，請稍候…';
      }
      sendJson(req, res, 200, getSnapshot());
    },
    handleFullScan(req, res) {
      if (allowAction('full-scan', fullScanMinIntervalMs)) {
        forceFull = true;
        lastPlan = '已送出完整掃瞄要求';
        void runCycle();
      } else {
        lastPlan = '完整掃瞄正在進行，請稍候…';
      }
      sendJson(req, res, 200, getSnapshot());
    },
  };
}
