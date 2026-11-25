import { useRef, useState } from 'react';
import { LINE_BY_CODE } from '../data/lines';
import { STATIONS } from '../data/stations';
import { STATUS_COLORS, type StatusResult } from '../domain/status';
import { findJourney, getAffectedStations, type Journey } from '../domain/journey';
import StationDropdown from './StationDropdown';

interface Props {
  stationResults: Record<string, StatusResult>;
  journey: Journey | null;
  onPlan: (journey: Journey | null) => void;
  onFocus: (code: string) => void;
}

interface PickerProps {
  label: string;
  value: string;
  onChange: (code: string) => void;
}

function StationPicker({ label, value, onChange }: PickerProps) {
  const [query, setQuery] = useState(value ? STATIONS[value].nameTc : '');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <label className="block text-[11px] font-semibold text-slate-500">{label}</label>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="站名 / 英文 / 代碼"
        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
      />
      {open && (
        <StationDropdown
          anchorRef={inputRef}
          query={query}
          limit={8}
          onSelect={(code) => { onChange(code); setQuery(STATIONS[code].nameTc); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function JourneyPanel({ stationResults, journey, onPlan, onFocus }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [focusQuery, setFocusQuery] = useState('');
  const [focusOpen, setFocusOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const focusInputRef = useRef<HTMLInputElement>(null);
  const affected = journey ? getAffectedStations(journey, stationResults) : [];
  const limitedService = journey?.stations.filter((code) => ['RAC', 'LMC', 'LOW'].includes(code)) ?? [];

  function plan() {
    if (!from || !to) return;
    onPlan(findJourney(from, to));
  }

  return (
    <div className={`pointer-events-auto absolute left-4 top-4 z-30 max-h-[calc(100%-2rem)] max-w-[calc(100vw-2rem)] overflow-auto rounded-2xl bg-white/95 p-3 shadow-xl ring-1 ring-slate-200 ${collapsed ? 'w-auto' : 'w-80'}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-ink">行程 / 站點搜尋</h2>
        <div className="flex gap-2">
          {journey && !collapsed && (
            <button type="button" onClick={() => onPlan(null)} className="text-[11px] text-slate-400 hover:text-ink">
              清除路線
            </button>
          )}
          <button type="button" onClick={() => setCollapsed((v) => !v)} className="text-[11px] text-blue-600 hover:underline">
            {collapsed ? '展開' : '收起'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
      <div className="grid grid-cols-2 gap-2">
        <StationPicker label="起點" value={from} onChange={setFrom} />
        <StationPicker label="終點" value={to} onChange={setTo} />
      </div>
      <button
        type="button"
        onClick={plan}
        disabled={!from || !to}
        className="mt-2 w-full rounded-lg bg-ink py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        顯示行程與受影響路段
      </button>

      <div className="relative mt-3 border-t border-slate-100 pt-2">
        <label className="block text-[11px] font-semibold text-slate-500">在地圖上定位車站</label>
        <input
          ref={focusInputRef}
          value={focusQuery}
          onChange={(event) => { setFocusQuery(event.target.value); setFocusOpen(true); }}
          onFocus={() => setFocusOpen(true)}
          placeholder="輸入站名搜尋"
          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        {focusOpen && (
          <StationDropdown
            anchorRef={focusInputRef}
            query={focusQuery}
            limit={6}
            onSelect={(code) => { onFocus(code); setFocusQuery(STATIONS[code].nameTc); setFocusOpen(false); }}
            onClose={() => setFocusOpen(false)}
          />
        )}
      </div>

      {journey && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold">{STATIONS[journey.stations[0]].nameTc} → {STATIONS[journey.stations.at(-1)!].nameTc}</span>
            <span className="ml-auto text-slate-500">{journey.stops} 站 · 轉車 {journey.interchangeCount} 次</span>
          </div>
          <div className="mt-2 space-y-1">
            {journey.segments.map((segment, index) => {
              const line = LINE_BY_CODE[segment.line];
              return (
                <div key={`${segment.line}-${index}`} className="flex items-start gap-2 text-[11px]">
                  <span className="mt-0.5 inline-block h-3 w-1 shrink-0 rounded" style={{ background: line.color }} />
                  <div className="min-w-0">
                    <div className="font-semibold">{line.nameTc}</div>
                    <div className="truncate text-slate-500">
                      {STATIONS[segment.from].nameTc} → {STATIONS[segment.to].nameTc}（{segment.stations.length - 1} 站）
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {limitedService.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-800">
              此路線途經
              {limitedService.map((code) => ` ${STATIONS[code].nameTc}`).join('、')}
              ，該等車站服務時間有限（馬場僅於賽馬日、羅湖／落馬洲受口岸開放時間影響），出發前請先確認。
            </div>
          )}

          <div className="mt-2 rounded-lg bg-slate-50 p-2">
            <div className="text-[11px] font-semibold">
              沿途受影響車站：{affected.length === 0 ? '無' : `${affected.length} 個`}
            </div>
            {affected.length > 0 && (
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto">
                {affected.map(({ code, result }) => (
                  <li key={code} className="flex items-center gap-2 text-[11px]">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[result.status] }} />
                    <span className="font-medium">{STATIONS[code].nameTc}</span>
                    <span className="ml-auto text-slate-500">{result.labelTc}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            路線以最少站數計算，並對轉車作 penalties；受影響判定為沿途最差狀態，僅供參考。
          </p>
        </div>
      )}
        </>
      )}
    </div>
  );
}
