import { describe, expect, it } from 'vitest';
import { parseRygXml } from './lineStatus';

const feed = (lines: string) => `<ryg_status>\n<lastBuildDate>Tue, 24 Nov 2026 06:15:00 GMT</lastBuildDate>\n${lines}\n</ryg_status>`;
const line = (code: string, status: string) => `<line><line_code>${code}</line_code><url_tc></url_tc><url_en></url_en><status>${status}</status></line>`;

describe('parseRygXml', () => {
  it('parses every line status', () => {
    const result = parseRygXml(feed([
      line('TWL', 'green'), line('EAL', 'red'), line('TKL', 'yellow'), line('DRL', 'grey'),
    ].join('')));
    expect(result).toEqual({ TWL: 'green', EAL: 'red', TKL: 'yellow', DRL: 'grey' });
  });

  it('handles the UTF-8 BOM sent by the upstream feed', () => {
    expect(parseRygXml(`\uFEFF${feed(line('KTL', 'green'))}`)).toEqual({ KTL: 'green' });
  });

  it('ignores unknown statuses and malformed lines', () => {
    const result = parseRygXml(feed([
      line('AEL', 'purple'), '<line><line_code>ISL</line_code></line>',
    ].join('')));
    expect(result).toEqual({});
  });
});
