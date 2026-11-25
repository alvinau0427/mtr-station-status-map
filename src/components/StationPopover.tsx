import { LINE_BY_CODE } from '../data/lines';
import { STATIONS } from '../data/stations';
import { STATUS_COLORS, type StatusResult } from '../domain/status';

export interface ArrivalView { ttnt: string; dest: string; plat: string }

interface Props {
  code: string;
  overall: StatusResult;
  perLine: Record<string, StatusResult>;
  arrivalsByLine: Record<string, { up: ArrivalView[]; down: ArrivalView[] }>;
  onClose: () => void;
}

function stationName(code: string) {
  return STATIONS[code]?.nameTc ?? code;
}

function DirectionArrivals({ label, items }: { label: string; items: ArrivalView[] }) {
  if (items.length === 0) return null;
  const sameDestination = items.every((item) => item.dest === items[0].dest);

  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold text-slate-500">
        {label} · 往{stationName(items[0].dest)}
      </div>
      <div className="space-y-0.5">
        {items.slice(0, 3).map((item, index) => (
          <div
            key={`${item.dest}-${item.ttnt}-${index}`}
            className="grid grid-cols-[1fr_44px_52px] items-center gap-1 text-[11px]"
          >
            <span className="truncate text-slate-700">{sameDestination ? '' : stationName(item.dest)}</span>
            <span className="tabular-nums text-slate-600">{item.ttnt} 分</span>
            <span className="text-right text-slate-500">月台 {item.plat || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StationPopover({ code, overall, perLine, arrivalsByLine, onClose }: Props) {
  const station = STATIONS[code];
  return (
    <div className="pointer-events-auto absolute right-4 top-20 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-ink">{station.nameTc}</h2>
          <p className="text-xs text-slate-500">{station.nameEn} · {code}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: STATUS_COLORS[overall.status] }} />
        <span className="text-sm font-semibold">{overall.labelTc}</span>
        {overall.stale && (
          <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">資料過期</span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {Object.entries(perLine).map(([lineCode, result]) => {
          const line = LINE_BY_CODE[lineCode];
          const arrivals = arrivalsByLine[lineCode] ?? { up: [], down: [] };
          const hasArrivals = arrivals.up.length > 0 || arrivals.down.length > 0;
          return (
            <div key={lineCode} className="border-t border-slate-100 pt-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: line.color }} />
                <span className="font-semibold">{line.nameTc}</span>
                <span className="ml-auto flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[result.status] }} />
                  {result.labelTc}
                </span>
              </div>
              {result.detail && <p className="mt-1 leading-relaxed text-slate-500">{result.detail}</p>}
              {result.url && (
                <a className="mt-1 block text-blue-600 underline" href={result.url} target="_blank" rel="noreferrer">
                  官方詳情
                </a>
              )}
              {hasArrivals && (
                <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                  <DirectionArrivals label="上行" items={arrivals.up} />
                  <DirectionArrivals label="下行" items={arrivals.down} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-slate-400">資料僅供參考，請以港鐵公告為準。</p>
    </div>
  );
}
