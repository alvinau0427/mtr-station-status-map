import { LINES } from '../data/lines';
import { STATIONS } from '../data/stations';
import type { StationStatus, StatusResult } from './status';

export interface JourneySegment {
  line: string;
  from: string;
  to: string;
  stations: string[];
}

export interface Journey {
  stations: string[];
  segments: JourneySegment[];
  interchangeCount: number;
  stops: number;
}

interface Edge { to: string; line: string }

const graph = new Map<string, Edge[]>();
for (const line of LINES) {
  for (let i = 0; i < line.stations.length - 1; i += 1) {
    const from = line.stations[i];
    const to = line.stations[i + 1];
    graph.set(from, [...(graph.get(from) ?? []), { to, line: line.code }]);
    graph.set(to, [...(graph.get(to) ?? []), { to: from, line: line.code }]);
  }
}

interface NodeState { code: string; line: string }
interface RouteState extends NodeState { cost: number; previous?: RouteState }

const key = (state: NodeState) => `${state.code}|${state.line}`;

/**
 * Find a route minimizing stops with a penalty for interchanges.
 * Search states include the line used to arrive, so changing line is discouraged.
 */
export function findJourney(from: string, to: string): Journey | null {
  if (!STATIONS[from] || !STATIONS[to]) return null;
  if (from === to) return { stations: [from], segments: [], interchangeCount: 0, stops: 0 };

  const queue: RouteState[] = STATIONS[from].lines.map((line) => ({ code: from, line, cost: 0 }));
  const best = new Map<string, number>(queue.map((state) => [key(state), 0]));
  let goal: RouteState | undefined;

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.cost > (best.get(key(current)) ?? Infinity)) continue;
    if (current.code === to) { goal = current; break; }

    for (const edge of graph.get(current.code) ?? []) {
      const interchange = edge.line === current.line ? 0 : 2;
      const next: RouteState = {
        code: edge.to,
        line: edge.line,
        cost: current.cost + 1 + interchange,
        previous: current,
      };
      const k = key(next);
      if (next.cost < (best.get(k) ?? Infinity)) {
        best.set(k, next.cost);
        queue.push(next);
      }
    }
  }

  if (!goal) return null;

  const states: RouteState[] = [];
  for (let cursor: RouteState | undefined = goal; cursor; cursor = cursor.previous) states.unshift(cursor);
  const stations = states.map((state) => state.code);

  const segments: JourneySegment[] = [];
  for (let i = 1; i < stations.length; i += 1) {
    const line = states[i].line;
    const last = segments[segments.length - 1];
    if (last && last.line === line) {
      last.to = stations[i];
      last.stations.push(stations[i]);
    } else {
      segments.push({ line, from: stations[i - 1], to: stations[i], stations: [stations[i - 1], stations[i]] });
    }
  }

  return {
    stations,
    segments,
    interchangeCount: Math.max(0, segments.length - 1),
    stops: stations.length - 1,
  };
}

export interface AffectedStation {
  code: string;
  result: StatusResult;
}

const AFFECTED: StationStatus[] = ['disruption', 'delay', 'special-arrangement', 'data-unavailable', 'error'];

export function getAffectedStations(journey: Journey, results: Record<string, StatusResult>): AffectedStation[] {
  return journey.stations
    .map((code) => ({ code, result: results[code] }))
    .filter((item): item is AffectedStation => Boolean(item.result) && AFFECTED.includes(item.result.status));
}

export function searchStations(query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return Object.values(STATIONS)
    .filter((station) => (
      station.code.toLowerCase().includes(q)
      || station.nameTc.includes(q)
      || station.nameEn.toLowerCase().includes(q)
    ))
    .slice(0, limit);
}
