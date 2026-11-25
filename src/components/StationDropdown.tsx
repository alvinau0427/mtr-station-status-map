import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { searchStations } from '../domain/journey';

interface Props {
  anchorRef: RefObject<HTMLInputElement | null>;
  query: string;
  onSelect: (code: string) => void;
  onClose: () => void;
  limit?: number;
}

interface Position { left: number; top: number; width: number; openUp: boolean }

/**
 * Station suggestions rendered in a portal so the panel's overflow cannot clip
 * them, and wide enough that three-character station names stay on one line.
 */
export default function StationDropdown({ anchorRef, query, onSelect, onClose, limit = 6 }: Props) {
  const [position, setPosition] = useState<Position | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const matches = searchStations(query, limit);

  useLayoutEffect(() => {
    const input = anchorRef.current;
    if (!input || query.trim() === '') { setPosition(null); return; }
    const rect = input.getBoundingClientRect();
    const width = Math.max(rect.width, 260);
    const openUp = window.innerHeight - rect.bottom < 240 && rect.top > 240;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      width,
      openUp,
    });
  }, [anchorRef, query]);

  useLayoutEffect(() => {
    setActive(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || listRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((current) => Math.min(current + 1, matches.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter' && matches[active]) {
        event.preventDefault();
        onSelect(matches[active].code);
      } else if (event.key === 'Escape') {
        onClose();
      }
    }
    const input = anchorRef.current;
    input?.addEventListener('keydown', onKeyDown);
    return () => input?.removeEventListener('keydown', onKeyDown);
  }, [anchorRef, matches, active, onSelect, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!position || query.trim() === '') return null;

  const style: CSSProperties = {
    position: 'fixed',
    left: position.left,
    top: position.top,
    width: position.width,
    maxHeight: 288,
    transform: position.openUp ? 'translateY(-100%)' : undefined,
    zIndex: 100,
  };

  return createPortal(
    <ul
      ref={listRef}
      style={style}
      className="overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
    >
      {matches.length === 0 && <li className="px-2 py-2 text-xs text-slate-400">找不到車站</li>}
      {matches.map((station, index) => (
        <li key={station.code}>
          <button
            type="button"
            data-active={index === active}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => { event.preventDefault(); onSelect(station.code); }}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
              index === active ? 'bg-blue-50' : 'hover:bg-blue-50'
            }`}
          >
            <span className="shrink-0 whitespace-nowrap font-semibold text-ink">{station.nameTc}</span>
            <span className="min-w-0 flex-1 truncate text-slate-400">{station.nameEn}</span>
            <span className="shrink-0 text-[10px] text-slate-400">{station.code}</span>
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
