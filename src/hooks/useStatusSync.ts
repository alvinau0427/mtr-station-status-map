import { useCallback, useEffect, useRef, useState } from 'react';
import { LINE_BY_CODE } from '../data/lines';
import { SCAN_INTERVAL_MS, selectLinesToScan, shouldFetchRyg } from '../domain/polling';
import type { LineStatus, StationObservation } from '../domain/status';
import { fetchLineStatuses } from '../services/lineStatus';
import { fetchSchedulesForLines, rateLimitRemainingMs } from '../services/mtrApi';

const CACHE_KEY = 'mtr-status-cache-v2';
const CACHE_VERSION = 2;
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
// Recent snapshots are trusted on restore; older ones are shown as stale and refreshed.
const CACHE_FRESH_MS = 3 * 60 * 1000;
const keyOf = (line: string, code: string) => `${line}-${code}`;

interface CachedSnapshot {
  version: number;
  observations: StationObservation[];
  lineStatuses: Record<string, LineStatus>;
  fetchedAt: string;
  lastFullScanAt: number | null;
  rygFetchedAt: number | null;
}

function loadCache(): CachedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    if (!Array.isArray(parsed.observations) || typeof parsed.lineStatuses !== 'object') return null;
    if (typeof parsed.fetchedAt !== 'string') return null;
    const age = Date.now() - Date.parse(parsed.fetchedAt);
    if (!Number.isFinite(age) || age < 0 || age > CACHE_MAX_AGE_MS) return null;
    if (!parsed.observations.every((item) => item && typeof item.line === 'string' && typeof item.code === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(snapshot: CachedSnapshot) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage may be unavailable (private mode / quota); caching is best-effort.
  }
}

export interface StatusSync {
  observations: Record<string, StationObservation>;
  lineStatuses: Record<string, LineStatus>;
  fetchedAt: string | null;
  lastFullScanAt: number | null;
  isSyncing: boolean;
  progress: { done: number; total: number };
  error?: string;
  lastPlan: string;
  refresh: () => void;
  fullScan: () => void;
}

/** Coordinates RYG-first polling, progressive updates, caching and stale-while-revalidate. */
export function useStatusSync(autoRefresh: boolean): StatusSync {
  const [observations, setObservations] = useState<Record<string, StationObservation>>({});
  const [lineStatuses, setLineStatuses] = useState<Record<string, LineStatus>>({});
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [lastFullScanAt, setLastFullScanAt] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | undefined>();
  const [lastPlan, setLastPlan] = useState('準備中');

  const observationsRef = useRef<Record<string, StationObservation>>({});
  const lineStatusesRef = useRef<Record<string, LineStatus>>({});
  const lastFullScanAtRef = useRef<number | null>(null);
  const fetchedAtRef = useRef<string | null>(null);
  const rygFetchedAtRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const syncingRef = useRef(false);

  // Restore the previous snapshot immediately so the map is coloured on first paint.
  useEffect(() => {
    const cached = loadCache();
    if (!cached) return;
    const cacheAge = Date.now() - Date.parse(cached.fetchedAt);
    const markStale = !Number.isFinite(cacheAge) || cacheAge >= CACHE_FRESH_MS;
    const restored: Record<string, StationObservation> = {};
    for (const observation of cached.observations) {
      restored[keyOf(observation.line, observation.code)] = markStale
        ? { ...observation, stale: true }
        : observation;
    }
    observationsRef.current = restored;
    lineStatusesRef.current = cached.lineStatuses ?? {};
    lastFullScanAtRef.current = cached.lastFullScanAt ?? null;
    fetchedAtRef.current = cached.fetchedAt ?? null;
    rygFetchedAtRef.current = cached.rygFetchedAt ?? null;
    setObservations(restored);
    setLineStatuses(cached.lineStatuses ?? {});
    setLastFullScanAt(cached.lastFullScanAt ?? null);
    setFetchedAt(cached.fetchedAt ?? null);
  }, []);

  const persist = useCallback(() => {
    saveCache({
      version: CACHE_VERSION,
      observations: Object.values(observationsRef.current),
      lineStatuses: lineStatusesRef.current,
      fetchedAt: fetchedAtRef.current ?? new Date().toISOString(),
      lastFullScanAt: lastFullScanAtRef.current,
      rygFetchedAt: rygFetchedAtRef.current,
    });
  }, []);

  const sync = useCallback(async (forceFull = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    setError(undefined);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      // The upstream feed only refreshes every 3 minutes; reuse it in between.
      if (
        Object.keys(lineStatusesRef.current).length === 0
        || shouldFetchRyg(Date.now(), rygFetchedAtRef.current, forceFull)
      ) {
        const latest = await fetchLineStatuses(controller.signal);
        lineStatusesRef.current = latest;
        rygFetchedAtRef.current = Date.now();
        setLineStatuses(latest);
      }
      const lines = lineStatusesRef.current;

      const now = Date.now();
      const plan = selectLinesToScan(lines, now, lastFullScanAtRef.current, forceFull);
      if (plan.fullScan) {
        lastFullScanAtRef.current = now;
        setLastFullScanAt(now);
      }

      // Always refresh lines that still carry stale observations, even when
      // RYG is all green and no full scan is due.
      const staleLines = new Set(
        Object.values(observationsRef.current)
          .filter((observation) => observation.stale)
          .map((observation) => observation.line),
      );
      const targetLines = [...new Set([...plan.lines, ...staleLines])];
      const totalPairs = targetLines.reduce((sum, line) => sum + (LINE_BY_CODE[line]?.stations.length ?? 0), 0);
      setProgress({ done: 0, total: totalPairs });
      setLastPlan(plan.fullScan
        ? `完整掃描（${targetLines.length} 條線 / ${totalPairs} 站）`
        : targetLines.length === 0
          ? '全線正常 · 略過站點查詢'
          : `${staleLines.size > 0 && plan.lines.length === 0 ? '更新過期站點' : '局部更新'}（${targetLines.join(', ')} / ${totalPairs} 站）`);

      if (targetLines.length > 0) {
        const pending: Record<string, StationObservation> = {};
        const result = await fetchSchedulesForLines(targetLines, controller.signal, (observation) => {
          const key = keyOf(observation.line, observation.code);
          const previous = observationsRef.current[key];
          // Stale-while-revalidate: keep the last good payload on a failed cycle.
          pending[key] = observation.error && previous?.api
            ? { ...previous, stale: true, error: observation.error }
            : observation;
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        });
        // Commit in one batch so the map does not change station-by-station.
        if (Object.keys(pending).length > 0) {
          const next = { ...observationsRef.current, ...pending };
          observationsRef.current = next;
          setObservations(next);
        }
        if (result.skipped > 0) {
          const seconds = Math.ceil(rateLimitRemainingMs() / 1000);
          setError(`API 節流中，已暫停站點查詢（約 ${seconds} 秒後恢復）。`);
        } else if (result.errors > 0) {
          setError(`本輪 ${result.errors} 個站點更新失敗，已保留上次資料。`);
        }
      }

      const timestamp = new Date().toISOString();
      fetchedAtRef.current = timestamp;
      setFetchedAt(timestamp);
      persist();
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '同步失敗');
      }
    } finally {
      syncingRef.current = false;
      controllerRef.current = null;
      setIsSyncing(false);
    }
  }, [persist]);

  useEffect(() => {
    void sync(false);
  }, [sync]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => { void sync(false); }, SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, sync]);

  return {
    observations,
    lineStatuses,
    fetchedAt,
    lastFullScanAt,
    isSyncing,
    progress,
    error,
    lastPlan,
    refresh: () => { void sync(false); },
    fullScan: () => { void sync(true); },
  };
}
