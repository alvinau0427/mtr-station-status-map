import { useState } from 'react';

interface Props {
  lastUpdated?: string | null;
  hasSnapshot: boolean;
  progress: { done: number; total: number };
  autoRefresh: boolean;
  onToggleAuto: () => void;
  onRefresh: () => void;
  onFullScan: () => void;
  isFetching: boolean;
  error?: string;
  counts: Record<string, number>;
  lastPlan: string;
  lastFullScanAt: number | null;
}

const time = (value?: string | number | null) => {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('zh-Hant', { hour12: false });
};

function BusyLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      {children}
    </span>
  );
}

export default function Toolbar({
  lastUpdated, hasSnapshot, progress, autoRefresh, onToggleAuto, onRefresh, onFullScan,
  isFetching, error, counts, lastPlan, lastFullScanAt,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const syncing = progress.total > 0 && progress.done < progress.total;

  return (
    <header className="relative z-40 bg-ink px-4 py-2 text-white shadow-lg">
      <div className="flex items-center gap-x-4 gap-y-1">
        <div className="mr-auto">
          <h1 className="text-sm font-bold leading-tight sm:text-lg">港鐵車務狀況圖</h1>
          <p className="hidden text-[10px] text-blue-200 sm:block">MTR Service Status Map</p>
        </div>

        <div className="hidden items-center gap-3 text-xs sm:flex">
          {Object.entries(counts).slice(0, 4).map(([key, value]) => (
            <span key={key} className="whitespace-nowrap text-blue-100">{key}: <b className="text-white">{value}</b></span>
          ))}
        </div>

        <div className="text-right text-[11px] leading-tight">
          <div className={error ? 'text-red-300' : 'text-blue-100'}>
            {error && <span className="mr-1 rounded bg-red-500/30 px-1.5 py-0.5 text-[10px]">降級模式</span>}
            {error ?? (!hasSnapshot
              ? '載入中…'
              : isFetching
                ? syncing ? `更新中 ${progress.done}/${progress.total}` : '同步中…'
                : '已同步')}
          </div>
          <div className="hidden text-blue-200 sm:block">
            更新 {time(lastUpdated)} · 完整掃描 {time(lastFullScanAt)}
          </div>
          <div className="hidden text-[10px] text-blue-300 sm:block">{lastPlan}</div>
        </div>

        <label className="hidden cursor-pointer items-center gap-1 text-xs sm:flex">
          <input type="checkbox" checked={autoRefresh} onChange={onToggleAuto} className="accent-blue-400" />
          自動更新
        </label>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          aria-live="polite"
          className="inline-flex min-w-[4.5rem] items-center justify-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-transform active:scale-95 disabled:opacity-70"
        >
          {isFetching ? <BusyLabel>更新中</BusyLabel> : '更新'}
        </button>
        <button
          type="button"
          onClick={onFullScan}
          disabled={isFetching}
          title="完整掃描所有車站（約 121 個請求）"
          className="hidden min-w-[5.5rem] items-center justify-center rounded-lg bg-blue-300 px-3 py-1.5 text-xs font-semibold text-ink transition-transform active:scale-95 disabled:opacity-70 sm:inline-flex"
        >
          {isFetching ? <BusyLabel>掃瞄中</BusyLabel> : '完整掃描'}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold sm:hidden"
          aria-label="更多選項"
        >
          ⋯
        </button>
      </div>

      {menuOpen && (
        <div className="absolute right-4 top-full z-50 mt-1 w-56 rounded-lg bg-white p-3 text-xs text-ink shadow-xl sm:hidden">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={autoRefresh} onChange={onToggleAuto} className="accent-blue-600" />
            自動更新
          </label>
          <button
            type="button"
            onClick={() => { onFullScan(); setMenuOpen(false); }}
            className="mt-2 w-full rounded bg-blue-100 px-2 py-1.5 font-semibold transition-transform active:scale-95"
          >
            {isFetching ? <BusyLabel>掃瞄中</BusyLabel> : '完整掃描'}
          </button>
          <p className="mt-2 text-[10px] text-slate-500">更新 {time(lastUpdated)} · 掃描 {time(lastFullScanAt)}</p>
          <p className="mt-1 text-[10px] text-slate-500">{lastPlan}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
            {Object.entries(counts).slice(0, 4).map(([key, value]) => (
              <span key={key}>{key}: {value}</span>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
