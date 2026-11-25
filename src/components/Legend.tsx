import { useState } from 'react';
import { STATUS_COLORS, type StationStatus } from '../domain/status';

const ITEMS: { status: StationStatus; tc: string }[] = [
  { status: 'normal', tc: '服務正常' },
  { status: 'delay', tc: '服務延誤' },
  { status: 'disruption', tc: '服務受阻' },
  { status: 'data-unavailable', tc: '資料異常／待確認' },
  { status: 'non-service', tc: '非服務時間' },
  { status: 'no-trains', tc: '目前無班次' },
  { status: 'error', tc: '無法取得資料' },
];

function LegendList() {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {ITEMS.map(({ status, tc }) => (
        <div key={status} className="flex items-center gap-2 whitespace-nowrap">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-white shadow"
            style={{ background: STATUS_COLORS[status] }}
          />
          <span>{tc}</span>
        </div>
      ))}
    </div>
  );
}

export default function Legend() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="pointer-events-auto absolute bottom-4 left-4 z-20 hidden rounded-xl bg-white/95 p-3 text-xs shadow-lg ring-1 ring-slate-200 sm:block">
        <div className="mb-2 font-bold text-ink">圖例</div>
        <LegendList />
      </div>

      <div className="pointer-events-auto absolute bottom-16 right-4 z-20 sm:hidden">
        {open && (
          <div className="mb-2 w-48 rounded-xl bg-white/95 p-3 text-xs shadow-lg ring-1 ring-slate-200">
            <div className="mb-2 font-bold text-ink">圖例</div>
            <LegendList />
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto block rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink shadow-lg ring-1 ring-slate-200"
        >
          {open ? '關閉圖例' : '圖例'}
        </button>
      </div>
    </>
  );
}
