import type { LineStatus, StationObservation } from '../domain/status';

export interface Snapshot {
  observations: StationObservation[];
  lineStatuses: Record<string, LineStatus>;
  fetchedAt: string | null;
  lastFullScanAt: number | null;
  scan: { done: number; total: number };
  lastPlan: string;
  degraded: boolean;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Snapshot>;
  return Array.isArray(candidate.observations)
    && typeof candidate.lineStatuses === 'object'
    && candidate.lineStatuses !== null
    && typeof candidate.scan === 'object'
    && candidate.scan !== null;
}

async function get(path: string, init?: RequestInit): Promise<Snapshot> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error(`Snapshot API HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isSnapshot(body)) throw new Error('Invalid snapshot response');
  return body;
}

/** Read the server's current in-memory snapshot. Never blocks on upstream. */
export function getSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  return get('/api/snapshot', { signal });
}

/** Ask the server to refresh urgent / incomplete lines immediately. */
export function requestRefresh(): Promise<Snapshot> {
  return get('/api/refresh', { method: 'POST' });
}

/** Ask the server to re-scan every active line immediately. */
export function requestFullScan(): Promise<Snapshot> {
  return get('/api/full-scan', { method: 'POST' });
}
