import { LINES } from '../data/lines';
import type { LineStatus } from './status';

/** Normal refresh cadence. */
export const SCAN_INTERVAL_MS = 60_000;
/** How often a full 121-pair station sweep is performed in the background. */
export const FULL_SCAN_INTERVAL_MS = 10 * 60_000;
/** The RYG feed itself refreshes every 3 minutes, so polling it faster is wasted traffic. */
export const RYG_CACHE_MS = 180_000;

export function shouldFetchRyg(now: number, lastFetchedAt: number | null, forceFull = false): boolean {
  return forceFull || lastFetchedAt === null || now - lastFetchedAt >= RYG_CACHE_MS;
}

export interface ScanPlan {
  lines: string[];
  fullScan: boolean;
}

/**
 * Decide which lines need per-station polling.
 *
 * RYG line status is checked first. Green lines need no station calls in a
 * normal cycle; only yellow/red lines do. A full sweep runs periodically (or
 * on demand) so station-level anomalies on otherwise-green lines are still
 * detected. Grey (non-service) lines are always skipped.
 */
export function selectLinesToScan(
  lineStatuses: Record<string, LineStatus>,
  now: number,
  lastFullScanAt: number | null,
  forceFull = false,
): ScanPlan {
  const active = LINES.filter((line) => lineStatuses[line.code] !== 'grey').map((line) => line.code);
  const fullScan = forceFull
    || lastFullScanAt === null
    || now - lastFullScanAt >= FULL_SCAN_INTERVAL_MS;

  if (fullScan) return { lines: active, fullScan };

  return {
    lines: active.filter((code) => lineStatuses[code] === 'yellow' || lineStatuses[code] === 'red'),
    fullScan: false,
  };
}
