import { z } from 'zod';
import { LINE_BY_CODE } from '../data/lines';
import type { StationApiResponse, StationObservation, TrainArrival } from '../domain/status';

// Routed through the dev/production proxy; see vite.config.ts and server/line-status-proxy.js.
const API_URL = '/api/schedule';

const arrivalSchema = z.object({
  ttnt: z.string().optional(),
  valid: z.string().optional(),
  plat: z.string().optional(),
  time: z.string().optional(),
  source: z.string().optional(),
  dest: z.string().optional(),
  seq: z.string().optional(),
});

const scheduleSchema = z.object({
  status: z.number(),
  message: z.string(),
  isdelay: z.string().optional(),
  url: z.string().optional(),
  curr_time: z.string().optional(),
  data: z.record(z.string(), z.object({
    UP: z.array(arrivalSchema).optional(),
    DOWN: z.array(arrivalSchema).optional(),
  }).passthrough()).optional(),
});

function toArrival(value: z.infer<typeof arrivalSchema>): TrainArrival {
  return {
    ttnt: value.ttnt ?? '',
    valid: value.valid ?? '',
    plat: value.plat ?? '',
    time: value.time ?? '',
    source: value.source ?? '',
    dest: value.dest ?? '',
    seq: value.seq ?? '',
  };
}

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Circuit breaker: after any 429, pause all station requests for a cooldown.
const CIRCUIT_COOLDOWN_MS = 60_000;
let rateLimitedUntil = 0;

export function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export function rateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}

function tripRateLimit(retryAfterHeader: string | null) {
  const seconds = Number(retryAfterHeader);
  const serverWait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + Math.max(CIRCUIT_COOLDOWN_MS, serverWait));
}

/** Test helper to clear the breaker between cases. */
export function resetRateLimitForTests() {
  rateLimitedUntil = 0;
}

/**
 * Fetch one line/station pair. At most two attempts per station: one retry on
 * 429 (honouring Retry-After) or on a transient network/server error.
 */
export async function fetchStationSchedule(
  line: string,
  sta: string,
  signal?: AbortSignal,
): Promise<StationApiResponse> {
  const url = `${API_URL}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(sta)}&lang=TC`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (response.status === 429) {
        tripRateLimit(response.headers.get('Retry-After'));
        if (attempt === 0) {
          const retryAfter = Number(response.headers.get('Retry-After'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800;
          await sleep(Math.min(wait, 5000));
          continue;
        }
        throw new Error('HTTP 429 (rate limited)');
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const parsed = scheduleSchema.parse(await response.json());
      const slot = parsed.data?.[`${line}-${sta}`];
      return {
        status: parsed.status,
        message: parsed.message,
        isdelay: parsed.isdelay,
        url: parsed.url,
        currTime: parsed.curr_time,
        up: (slot?.UP ?? []).map(toArrival),
        down: (slot?.DOWN ?? []).map(toArrival),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === 0 && !(error instanceof Error && error.message.startsWith('HTTP 429'))) {
        await sleep(400);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Fetch failed');
}

interface Pair { line: string; code: string }

function pairsForLines(lines: string[]): Pair[] {
  return lines.flatMap((line) =>
    (LINE_BY_CODE[line]?.stations ?? []).map((code) => ({ line, code })),
  );
}

/** Run an async mapper with bounded concurrency. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface FetchResult {
  requested: number;
  completed: number;
  errors: number;
  skipped: number;
}

/**
 * Fetch station schedules for the selected lines. Each observation is passed
 * to `onObservation` as soon as it arrives so the map can update progressively.
 */
export async function fetchSchedulesForLines(
  lines: string[],
  signal: AbortSignal | undefined,
  onObservation: (observation: StationObservation) => void,
): Promise<FetchResult> {
  const pairs = pairsForLines(lines);
  let completed = 0;
  let errors = 0;
  let skipped = 0;

  await mapWithConcurrency(pairs, 5, async ({ line, code }) => {
    if (isRateLimited()) {
      skipped += 1;
      completed += 1;
      return;
    }
    const fetchedAt = new Date().toISOString();
    try {
      // Spread requests out: peak request rate, not total volume, is what
      // triggers CDN throttling during the 121-pair full sweep.
      await sleep(300 + Math.random() * 500);
      const api = await fetchStationSchedule(line, code, signal);
      onObservation({ line, code, api, fetchedAt });
    } catch (error) {
      errors += 1;
      onObservation({
        line,
        code,
        error: error instanceof Error ? error.message : 'Fetch failed',
        fetchedAt,
      });
    } finally {
      completed += 1;
    }
  });

  return { requested: pairs.length, completed, errors, skipped };
}

export const TOTAL_PAIRS = pairsForLines(Object.keys(LINE_BY_CODE)).length;
