export type StationStatus =
  | 'normal'
  | 'delay'
  | 'disruption'
  | 'special-arrangement'
  | 'data-unavailable'
  | 'non-service'
  | 'no-trains'
  | 'unknown'
  | 'error';

export type LineStatus = 'green' | 'yellow' | 'red' | 'grey';

export interface TrainArrival {
  time: string;
  dest: string;
  plat: string;
  ttnt: string;
  seq: string;
  valid: string;
  source: string;
}

export interface StationApiResponse {
  status: number;
  message: string;
  isdelay?: string;
  url?: string;
  currTime?: string;
  up: TrainArrival[];
  down: TrainArrival[];
}

export interface StationObservation {
  code: string;
  line: string;
  api?: StationApiResponse;
  error?: string;
  /** True when this observation was kept from a previous cycle after a fetch failure or from local cache. */
  stale?: boolean;
  fetchedAt: string;
}

export interface StatusResult {
  status: StationStatus;
  labelTc: string;
  labelEn: string;
  detail?: string;
  url?: string;
  stale?: boolean;
}

const LABELS: Record<StationStatus, { tc: string; en: string }> = {
  normal: { tc: '服務正常', en: 'Normal service' },
  delay: { tc: '服務延誤', en: 'Service delay (inferred)' },
  disruption: { tc: '服務受阻', en: 'Service disruption (inferred)' },
  'special-arrangement': { tc: '特別車務安排', en: 'Special arrangements' },
  'data-unavailable': { tc: '資料異常／待確認', en: 'Data unavailable / unconfirmed' },
  'non-service': { tc: '非服務時間', en: 'Non-service hours' },
  'no-trains': { tc: '目前無班次', en: 'No trains at present' },
  unknown: { tc: '資料載入中', en: 'Loading' },
  error: { tc: '無法取得資料', en: 'Data unavailable' },
};

const SEVERITY: Record<StationStatus, number> = {
  disruption: 7,
  delay: 6,
  'special-arrangement': 5,
  'data-unavailable': 4,
  error: 4,
  unknown: 3,
  'non-service': 2,
  'no-trains': 2,
  normal: 1,
};

/** Largest gap between consecutive trains, in minutes. Used as supporting detail only. */
export function maxHeadway(arrivals: TrainArrival[]): number {
  const minutes = arrivals
    .map((a) => Number(a.ttnt))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let max = 0;
  for (let i = 1; i < minutes.length; i += 1) {
    max = Math.max(max, minutes[i] - minutes[i - 1]);
  }
  return max;
}

/** Infer a single line/station status from the official API response and line-level RYG feed. */
export function inferStatus(
  observation: StationObservation | undefined,
  lineStatus: LineStatus | undefined,
): StatusResult {
  let result: StatusResult;

  const label = (status: StationStatus, detail?: string, url?: string): StatusResult => ({
    status,
    labelTc: LABELS[status].tc,
    labelEn: LABELS[status].en,
    detail,
    url,
  });

  if (lineStatus === 'grey') {
    result = label('non-service');
  } else if (!observation) {
    if (lineStatus === 'red') result = label('disruption', 'Line-level alert; station detail unavailable');
    else if (lineStatus === 'yellow') result = label('delay', 'Line-level alert; station detail unavailable');
    else if (lineStatus === 'green') {
      // Provisional first paint: RYG says the line is fine, station-level
      // observations have not arrived yet (cold start / warming server).
      result = label('normal', '初步判斷：等待站級資料');
    } else result = label('unknown');
  } else if (!observation.api) {
    result = observation.error
      ? label('error', observation.error)
      : label('unknown');
  } else {
    const api = observation.api;
    if (api.status === 0) {
      if (/suspend|closed|terminat/i.test(api.message)) result = label('disruption', api.message);
      else if (api.url || /special|arrangement|alert/i.test(api.message)) result = label('special-arrangement', api.message, api.url);
      else result = label('disruption', api.message);
    } else {
      const arrivals = [...api.up, ...api.down];
      if (api.isdelay === 'Y') {
        if (arrivals.length === 0) result = label('data-unavailable', 'No train data returned while the API reports a delay.');
        else {
          const gap = Math.max(maxHeadway(api.up), maxHeadway(api.down));
          result = label('delay', gap >= 10 ? `最大班距約 ${gap} 分鐘。` : undefined);
        }
      } else if (arrivals.length === 0) {
        // e.g. Racecourse outside racedays. A successful API response with no
        // trains is not a data error — it means no service at present.
        result = label('no-trains', 'API 回報成功，但目前沒有班次（可能非服務時間或特別安排）。');
      } else {
        result = label('normal');
      }
    }
  }

  if (observation?.stale && result.status !== 'unknown') {
    const lastKnown = result.labelTc;
    result = {
      status: 'unknown',
      labelTc: '資料過期',
      labelEn: 'Stale data',
      detail: `上次已知狀態：${lastKnown}。此為上一次成功取得的資料，可能已過期。`,
      url: result.url,
      stale: true,
    };
  }
  return result;
}

/** Combine per-line observations for an interchange station into one marker status. */
export function combineStatuses(results: StatusResult[]): StatusResult {
  if (results.length === 0) return inferStatus(undefined, undefined);
  return results.reduce((worst, current) => (
    SEVERITY[current.status] > SEVERITY[worst.status] ? current : worst
  ));
}

export const STATUS_COLORS: Record<StationStatus, string> = {
  normal: '#1db954',
  delay: '#f5b301',
  disruption: '#d71920',
  'special-arrangement': '#f5b301',
  'data-unavailable': '#f07f1a',
  'non-service': '#9aa5b1',
  'no-trains': '#9aa5b1',
  unknown: '#c7ced6',
  error: '#6b7280',
};
