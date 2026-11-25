import trainSvg from '../assets/train.svg?raw';
import { STATUS_COLORS, type StationStatus } from '../domain/status';

/** Priority: disruption > delay > data-unavailable > majority grey > normal. */
export function faviconStatus(statuses: StationStatus[]): StationStatus {
  if (statuses.some((status) => status === 'disruption' || status === 'error')) return 'disruption';
  if (statuses.some((status) => status === 'delay' || status === 'special-arrangement')) return 'delay';
  if (statuses.some((status) => status === 'data-unavailable')) return 'data-unavailable';
  if (statuses.length > 0
    && statuses.filter((status) => status === 'non-service' || status === 'no-trains').length / statuses.length >= 0.5) {
    return 'non-service';
  }
  return 'normal';
}

/**
 * Uses the supplied train-front SVG, replacing its square background with a
 * large-corner rounded square in the current status colour.
 */
export function faviconDataUrl(status: StationStatus): string {
  const color = STATUS_COLORS[status];
  const svg = trainSvg
    .replace(
      /<rect[\s\S]*?\/>/,
      `<rect width="500" height="500" rx="90" fill="${color}"/>`,
    )
    .replace(
      /<g\s+id="layer2">/,
      '<g id="layer2" transform="translate(50 50) scale(0.8)">',
    );
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
