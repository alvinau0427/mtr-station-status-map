import { useCallback, useEffect, useRef, useState } from 'react';
import type { LineStatus, StationObservation } from '../domain/status';
import {
  getSnapshot,
  requestFullScan,
  requestRefresh,
  type Snapshot,
} from '../services/snapshotApi';

const CACHE_KEY = 'mtr-status-cache-v2';
const CACHE_VERSION = 2;
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const CACHE_FRESH_MS = 3 * 60 * 1000;
const SNAPSHOT_POLL_MS = 10_000;
const FOLLOW_UP_MS = 1_500;
const keyOf = (line: string, code: string) => `${line}-${code}`;

interface CachedSnapshot {
  version: number;
  observations: StationObservation[];
  lineStatuses: Record<string, LineStatus>;
  fetchedAt: string;
  lastFullScanAt: number | null;
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
  /** False until the first server snapshot arrives — used to show a loading state. */
  hasSnapshot: boolean;
  fetchedAt: string | null;
  lastFullScanAt: number | null;
  isSyncing: boolean;
  progress: { done: number; total: number };
  error?: string;
  lastPlan: string;
  refresh: () => void;
  fullScan: () => void;
}

/**
 * Reads the server-owned snapshot. localStorage is only used to paint the
 * first frame before the first snapshot arrives; the server is the sole
 * source of truth afterwards.
 */
export function useStatusSync(autoRefresh: boolean, initialSnapshot?: Snapshot): StatusSync {
  const [observations, setObservations] = useState<Record<string, StationObservation>>({});
  const [lineStatuses, setLineStatuses] = useState<Record<string, LineStatus>>({});
  const [hasSnapshot, setHasSnapshot] = useState(false);
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
  const busyRef = useRef(false);
  const actionActiveRef = useRef(false);
  const followUpRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const persist = useCallback(() => {
    saveCache({
      version: CACHE_VERSION,
      observations: Object.values(observationsRef.current),
      lineStatuses: lineStatusesRef.current,
      fetchedAt: fetchedAtRef.current ?? new Date().toISOString(),
      lastFullScanAt: lastFullScanAtRef.current,
    });
  }, []);

  const applySnapshot = useCallback((snapshot: Snapshot) => {
    const next = { ...observationsRef.current };
    const incoming = new Set<string>();
    for (const observation of snapshot.observations) {
      const key = keyOf(observation.line, observation.code);
      incoming.add(key);
      next[key] = observation;
    }
    // Only treat locally-held stations as stale once the server has data.
    if (snapshot.observations.length > 0) {
      for (const key of Object.keys(next)) {
        if (!incoming.has(key) && !next[key].stale) next[key] = { ...next[key], stale: true };
      }
    }
    observationsRef.current = next;
    lineStatusesRef.current = snapshot.lineStatuses;
    fetchedAtRef.current = snapshot.fetchedAt ?? fetchedAtRef.current;
    lastFullScanAtRef.current = snapshot.lastFullScanAt ?? lastFullScanAtRef.current;
    setObservations(next);
    setLineStatuses(snapshot.lineStatuses);
    // Wait for RYG data before removing the overlay; an empty snapshot on a
    // cold server would otherwise show every station as grey "loading".
    setHasSnapshot(Object.keys(snapshot.lineStatuses).length > 0);
    setFetchedAt(fetchedAtRef.current);
    setLastFullScanAt(lastFullScanAtRef.current);
    setProgress(snapshot.scan);
    setIsSyncing(actionActiveRef.current || (snapshot.scan.total > 0 && snapshot.scan.done < snapshot.scan.total));
    setLastPlan(snapshot.degraded ? '上游節流中 · 保留上次資料' : snapshot.lastPlan);
    setError(snapshot.degraded ? '上游節流中，部分資料稍後更新。' : undefined);
    persist();
  }, [persist]);

  // Use the prefetched snapshot when available (it arrived before React
  // mounted); otherwise restore the previous snapshot for the first paint.
  useEffect(() => {
    if (initialSnapshot) {
      applySnapshot(initialSnapshot);
      return;
    }
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
    setObservations(restored);
    setLineStatuses(cached.lineStatuses ?? {});
    setLastFullScanAt(cached.lastFullScanAt ?? null);
    setFetchedAt(cached.fetchedAt ?? null);
  }, [initialSnapshot, applySnapshot]);

  const poll = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      applySnapshot(await getSnapshot(controller.signal));
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '無法取得伺服器資料');
      }
    } finally {
      busyRef.current = false;
      controllerRef.current = null;
    }
  }, [applySnapshot]);

  const scheduleFollowUp = useCallback(() => {
    if (followUpRef.current !== null) window.clearTimeout(followUpRef.current);
    followUpRef.current = window.setTimeout(() => {
      followUpRef.current = null;
      actionActiveRef.current = false;
      void poll();
    }, FOLLOW_UP_MS);
  }, [poll]);

  const act = useCallback(async (
    request: () => Promise<Snapshot>,
    pendingPlan: string,
  ) => {
    actionActiveRef.current = true;
    setIsSyncing(true);
    setLastPlan(pendingPlan);
    try {
      applySnapshot(await request());
    } catch (cause) {
      actionActiveRef.current = false;
      setError(cause instanceof Error ? cause.message : '要求更新失敗');
      setIsSyncing(false);
    } finally {
      scheduleFollowUp();
    }
  }, [applySnapshot, scheduleFollowUp]);

  useEffect(() => {
    if (!initialSnapshot) void poll();
    if (!autoRefresh) return;
    const id = window.setInterval(() => { void poll(); }, SNAPSHOT_POLL_MS);
    return () => window.clearInterval(id);
  }, [poll, autoRefresh, initialSnapshot]);

  useEffect(() => () => {
    if (followUpRef.current !== null) window.clearTimeout(followUpRef.current);
    controllerRef.current?.abort();
  }, []);

  return {
    observations,
    lineStatuses,
    hasSnapshot,
    fetchedAt,
    lastFullScanAt,
    isSyncing,
    progress,
    error,
    lastPlan,
    refresh: () => { void act(requestRefresh, '已送出更新要求…'); },
    fullScan: () => { void act(requestFullScan, '已送出完整掃瞄要求…'); },
  };
}
