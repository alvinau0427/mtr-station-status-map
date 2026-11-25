import { useEffect, useMemo, useState } from 'react';
import Toolbar from './components/Toolbar';
import RouteMap from './components/RouteMap';
import Legend from './components/Legend';
import JourneyPanel from './components/JourneyPanel';
import type { Journey } from './domain/journey';
import { STATIONS } from './data/stations';
import {
  combineStatuses,
  inferStatus,
  type StationObservation,
  type StatusResult,
} from './domain/status';
import { useStatusSync } from './hooks/useStatusSync';
import type { Snapshot } from './services/snapshotApi';
import { faviconDataUrl, faviconStatus } from './utils/favicon';

export default function App({ initialSnapshot }: { initialSnapshot?: Snapshot }) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [footerOpen, setFooterOpen] = useState(false);

  const sync = useStatusSync(autoRefresh, initialSnapshot);

  const observations = useMemo(() => sync.observations, [sync.observations]);
  const lineStatuses = sync.lineStatuses;

  const stationResults = useMemo(() => {
    const results: Record<string, StatusResult> = {};
    for (const code of Object.keys(STATIONS)) {
      results[code] = combineStatuses(
        STATIONS[code].lines.map((line) => {
          const observation: StationObservation | undefined = observations[`${line}-${code}`];
          return inferStatus(observation, lineStatuses[line]);
        }),
      );
    }
    return results;
  }, [observations, lineStatuses]);

  // Tab icon priority: disruption > delay > data-unavailable > majority grey > normal.
  useEffect(() => {
    const iconStatus = faviconStatus(Object.values(stationResults).map((result) => result.status));
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = faviconDataUrl(iconStatus);
  }, [stationResults]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const status of Object.values(stationResults)) {
      const key = status.labelTc;
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  }, [stationResults]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        lastUpdated={sync.fetchedAt}
        hasSnapshot={sync.hasSnapshot}
        progress={sync.progress}
        autoRefresh={autoRefresh}
        onToggleAuto={() => setAutoRefresh((v) => !v)}
        onRefresh={sync.refresh}
        onFullScan={sync.fullScan}
        isFetching={sync.isSyncing}
        error={sync.error}
        counts={counts}
        lastPlan={sync.lastPlan}
        lastFullScanAt={sync.lastFullScanAt}
      />
      <main className="relative min-h-0 flex-1">
        <RouteMap
          observations={observations}
          lineStatuses={lineStatuses}
          stationResults={stationResults}
          journey={journey}
          focusCode={focusCode}
          hasSnapshot={sync.hasSnapshot}
        />
        <div className="hidden sm:block">
          <JourneyPanel
            stationResults={stationResults}
            journey={journey}
            onPlan={setJourney}
            onFocus={setFocusCode}
          />
        </div>
        <Legend />
      </main>
      <footer className="z-40 hidden shrink-0 border-t border-slate-200 bg-white/90 px-4 py-1.5 text-right text-[10px] text-slate-500 sm:block">
        <p
          onClick={() => setFooterOpen((value) => !value)}
          className={`cursor-pointer text-right sm:cursor-default ${footerOpen ? '' : 'truncate'} sm:truncate`}
          title="點按查看完整說明"
        >
          本網站所示站點狀態為依據公開數據之推論結果，僅供參考；實際車務安排請以
          <a href="https://www.mtr.com.hk/" target="_blank" rel="noopener noreferrer" className="mx-1 underline hover:text-ink">港鐵官方公告</a>
          為準。路線圖版權屬
          <a href="https://www.mtr.com.hk/en/customer/services/system_map.html" target="_blank" rel="noopener noreferrer" className="mx-1 underline hover:text-ink">港鐵有限公司</a>
          所有，本網站屬非官方演示項目。
        </p>
      </footer>
    </div>
  );
}
