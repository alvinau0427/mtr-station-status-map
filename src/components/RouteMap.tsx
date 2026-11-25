import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { STATIONS } from '../data/stations';
import { MAP_VIEWBOX, STATION_COORDINATES } from '../data/stationCoordinates';
import { ANCHOR_STYLES } from '../data/anchorShapes';
import {
  STATUS_COLORS,
  combineStatuses,
  inferStatus,
  type LineStatus,
  type StationObservation,
  type StatusResult,
} from '../domain/status';
import StationPopover from './StationPopover';
import type { Journey } from '../domain/journey';

interface Props {
  observations: Record<string, StationObservation>;
  lineStatuses: Record<string, LineStatus>;
  stationResults: Record<string, StatusResult>;
  journey: Journey | null;
  focusCode: string | null;
  hasSnapshot: boolean;
}

interface Transform { scale: number; x: number; y: number }

export default function RouteMap({ observations, lineStatuses, stationResults, journey, focusCode, hasSnapshot }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef({ time: 0, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const highlighted = useMemo(() => new Set(journey?.stations ?? []), [journey]);

  // Track mobile layout. On phones the map is rotated 90° clockwise and covers
  // the viewport; on desktop it is shown unrotated at its natural aspect ratio.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Measure the container and size the wrapper so the map is never distorted.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const widthFit = container.clientWidth / MAP_VIEWBOX.width;
      const heightFit = container.clientHeight / MAP_VIEWBOX.height;
      const fit = isMobile
        ? Math.max(container.clientWidth / MAP_VIEWBOX.height, container.clientHeight / MAP_VIEWBOX.width)
        : Math.min(widthFit, heightFit);
      setMapSize({
        width: MAP_VIEWBOX.width * fit,
        height: MAP_VIEWBOX.height * fit,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isMobile]);

  /** Keep at least 200px of the map visible so it can never be dragged entirely off-screen. */
  function clampTransform(next: Transform): Transform {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return next;

    // After a 90° rotation the visual width/height are swapped.
    const visualW = isMobile ? wrapper.offsetHeight : wrapper.offsetWidth;
    const visualH = isMobile ? wrapper.offsetWidth : wrapper.offsetHeight;
    const halfW = (visualW * next.scale) / 2;
    const halfH = (visualH * next.scale) / 2;
    const minX = 200 - container.clientWidth / 2 - halfW;
    const maxX = container.clientWidth / 2 + halfW - 200;
    const minY = 200 - container.clientHeight / 2 - halfH;
    const maxY = container.clientHeight / 2 + halfH - 200;

    return {
      scale: Math.min(6, Math.max(1, next.scale)),
      x: minX > maxX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, next.x)),
      y: minY > maxY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, next.y)),
    };
  }

  useEffect(() => {
    if (!focusCode || !wrapperRef.current) return;
    const coords = STATION_COORDINATES[focusCode];
    if (!coords) return;
    const width = wrapperRef.current.offsetWidth;
    const height = wrapperRef.current.offsetHeight;
    const scale = 2.5;
    const nx = coords.x / MAP_VIEWBOX.width - 0.5;
    const ny = coords.y / MAP_VIEWBOX.height - 0.5;
    setSelected(focusCode);
    // rotate(90deg) maps an offset (nx*width, ny*height) to (-ny*height, nx*width).
    setTransform(clampTransform(isMobile
      ? { scale, x: ny * height * scale, y: -nx * width * scale }
      : { scale, x: -nx * width * scale, y: -ny * height * scale }));
  }, [focusCode, isMobile]);

  const perLineForSelected = useMemo(() => {
    const results: Record<string, StatusResult> = {};
    const arrivals: Record<string, { up: { ttnt: string; dest: string; plat: string }[]; down: { ttnt: string; dest: string; plat: string }[] }> = {};
    if (!selected) return { results, arrivals };
    for (const line of STATIONS[selected].lines) {
      const observation = observations[`${line}-${selected}`];
      results[line] = inferStatus(observation, lineStatuses[line]);
      const toView = (a: { ttnt: string; dest: string; plat: string }) => ({ ttnt: a.ttnt, dest: a.dest, plat: a.plat });
      arrivals[line] = {
        up: (observation?.api?.up ?? []).map(toView),
        down: (observation?.api?.down ?? []).map(toView),
      };
    }
    return { results, arrivals };
  }, [selected, observations, lineStatuses]);

  // React registers onWheel as passive, which forbids preventDefault(). Attach
  // a native non-passive listener so the page does not zoom/scroll while the
  // map zooms, and the console stays free of "Unable to preventDefault" errors.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setTransform((prev) => clampTransform({ ...prev, scale: prev.scale * factor }));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic / some touch events have no active pointer to capture.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: transform.scale,
      };
      drag.current = null;
      return;
    }
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y };
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const start = pinch.current;
      setTransform((prev) => clampTransform({ ...prev, scale: start.scale * (distance / start.distance) }));
      return;
    }

    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    setTransform((prev) => clampTransform({ ...prev, x: current.tx + dx, y: current.ty + dy }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (isMobile && event.pointerType === 'touch') {
      const now = Date.now();
      const previous = lastTap.current;
      if (now - previous.time < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 30) {
        resetView();
        lastTap.current = { time: 0, x: 0, y: 0 };
      } else {
        lastTap.current = { time: now, x: event.clientX, y: event.clientY };
      }
    }
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [point] = [...pointers.current.values()];
      drag.current = { x: point.x, y: point.y, tx: transform.x, ty: transform.y };
    } else {
      drag.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetView() {
    setTransform(clampTransform({ scale: 1, x: 0, y: 0 }));
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      aria-label="港鐵路線圖，可用鍵盤方向鍵平移、加减號縮放、Esc 重置"
      className="relative h-full w-full touch-none select-none overflow-hidden bg-[#e8f4fa] focus:outline-none"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input, button, a')) return;
        const step = 120;
        const move = (x: number, y: number) => setTransform((prev) => clampTransform({ ...prev, x: prev.x + x, y: prev.y + y }));
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(step, 0); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); move(-step, 0); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(0, step); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); move(0, -step); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); setTransform((p) => clampTransform({ ...p, scale: p.scale * 1.25 })); }
        else if (event.key === '-') { event.preventDefault(); setTransform((p) => clampTransform({ ...p, scale: p.scale / 1.25 })); }
        else if (event.key === 'Escape') { event.preventDefault(); resetView(); }
      }}
      onDragStart={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
        resetView();
      }}
    >
      <div
        ref={wrapperRef}
        className="absolute left-1/2 top-1/2 origin-center map-shadow select-none"
        style={{
          width: mapSize ? `${mapSize.width}px` : '100%',
          height: mapSize ? `${mapSize.height}px` : 'auto',
          visibility: mapSize ? 'visible' : 'hidden',
          transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) scale(${transform.scale}) rotate(${isMobile ? 90 : 0}deg)`,
        }}
      >
        <img
          src="/routemap.svg"
          alt="MTR system map"
          className="absolute inset-0 h-full w-full select-none"
          draggable={false}
        />
        {hasSnapshot && Object.entries(STATIONS).map(([code, station]) => {
          const coords = STATION_COORDINATES[code];
          if (!coords) return null;
          const status = stationResults[code] ?? inferStatus(undefined, undefined);
          const isSelected = selected === code;
          const anchor = ANCHOR_STYLES[code] ?? { shape: 'circle' as const, w: 44, h: 44 };
          return (
            <button
              key={code}
              type="button"
              data-marker
              title={`${station.nameTc} — ${status.labelTc}`}
              aria-label={`${station.nameTc}, ${status.labelTc}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelected((prev) => (prev === code ? null : code));
              }}
              className={`absolute rounded-full border-2 border-white shadow-md transition-transform hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                journey && !highlighted.has(code) ? 'opacity-30' : ''
              } ${highlighted.has(code) ? 'ring-2 ring-blue-600' : ''}`}
              style={{
                left: `${(coords.x / MAP_VIEWBOX.width) * 100}%`,
                top: `${(coords.y / MAP_VIEWBOX.height) * 100}%`,
                width: `${(anchor.w / MAP_VIEWBOX.width) * 100}%`,
                height: `${(anchor.h / MAP_VIEWBOX.height) * 100}%`,
                transform: `translate(-50%, -50%) scale(${isSelected ? 1.5 : 1})`,
                background: STATUS_COLORS[status.status],
                zIndex: isSelected ? 12 : highlighted.has(code) ? 8 : 5,
              }}
            />
          );
        })}
      </div>

      {!hasSnapshot && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#e8f4fa]/60"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 rounded-xl bg-white/90 px-5 py-3 text-sm font-semibold text-ink shadow-lg ring-1 ring-slate-200">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" aria-hidden="true" />
            正在載入車務資料…
          </div>
        </div>
      )}

      <div className="pointer-events-auto absolute bottom-4 right-4 z-20 hidden gap-2 sm:flex">
        <button
          type="button"
          onClick={() => setTransform((p) => clampTransform({ ...p, scale: p.scale * 1.25 }))}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink shadow ring-1 ring-slate-200"
        >＋</button>
        <button
          type="button"
          onClick={() => setTransform((p) => clampTransform({ ...p, scale: p.scale / 1.25 }))}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink shadow ring-1 ring-slate-200"
        >－</button>
        <button
          type="button"
          onClick={resetView}
          title="重置視角"
          aria-label="重置視角"
          className="rounded-lg bg-white p-2 text-ink shadow ring-1 ring-slate-200 hover:brightness-95"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>

      {selected && (
        <StationPopover
          code={selected}
          overall={stationResults[selected] ?? combineStatuses([])}
          perLine={perLineForSelected.results}
          arrivalsByLine={perLineForSelected.arrivals}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
