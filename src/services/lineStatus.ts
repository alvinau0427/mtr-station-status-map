import type { LineStatus } from '../domain/status';

const RYG_URL = '/api/line-status';

/** Parse the simple RYG feed. Handles the UTF-8 BOM sent by the upstream server. */
export function parseRygXml(text: string): Record<string, LineStatus> {
  const xml = text.replace(/^\uFEFF/, '');
  const result: Record<string, LineStatus> = {};
  const linePattern = /<line>([\s\S]*?)<\/line>/g;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(xml)) !== null) {
    const code = /<line_code>([\s\S]*?)<\/line_code>/.exec(match[1])?.[1]?.trim();
    const status = /<status>([\s\S]*?)<\/status>/.exec(match[1])?.[1]?.trim();
    if (code && status && ['green', 'yellow', 'red', 'grey'].includes(status)) {
      result[code] = status as LineStatus;
    }
  }
  return result;
}

/** Fetch and parse the official RYG line status feed through the local proxy. */
export async function fetchLineStatuses(signal?: AbortSignal): Promise<Record<string, LineStatus>> {
  const response = await fetch(RYG_URL, { signal, headers: { Accept: 'text/xml' } });
  if (!response.ok) throw new Error(`RYG feed HTTP ${response.status}`);

  const lines = parseRygXml(await response.text());
  if (Object.keys(lines).length === 0) throw new Error('Invalid or empty RYG XML');
  return lines;
}
