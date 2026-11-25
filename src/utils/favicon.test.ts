import { describe, expect, it } from 'vitest';
import { faviconDataUrl, faviconStatus } from './favicon';

describe('faviconStatus', () => {
  it('is green when every station is normal', () => {
    expect(faviconStatus(['normal', 'normal', 'normal'])).toBe('normal');
  });

  it('is red when any station is disrupted or errored', () => {
    expect(faviconStatus(['normal', 'disruption'])).toBe('disruption');
    expect(faviconStatus(['normal', 'error'])).toBe('disruption');
  });

  it('is yellow when any station is delayed, taking priority over orange/grey', () => {
    expect(faviconStatus(['delay', 'data-unavailable', 'non-service'])).toBe('delay');
  });

  it('is orange when a station has data unavailable', () => {
    expect(faviconStatus(['normal', 'data-unavailable'])).toBe('data-unavailable');
  });

  it('is grey only when at least half the stations are non-service', () => {
    expect(faviconStatus(['non-service', 'non-service', 'normal'])).toBe('non-service');
    expect(faviconStatus(['non-service', 'normal', 'normal'])).toBe('normal');
    expect(faviconStatus(['no-trains', 'normal'])).toBe('non-service');
  });

  it('ignores loading stations', () => {
    expect(faviconStatus(['unknown', 'unknown'])).toBe('normal');
  });
});

describe('faviconDataUrl', () => {
  it('embeds the train glyph with a rounded square of the status colour', () => {
    const url = faviconDataUrl('delay');
    const svg = decodeURIComponent(url.split('data:image/svg+xml,')[1]);
    expect(svg).toContain('rx="90"');
    expect(svg).toContain('fill="#f5b301"');
    expect(svg).toContain('path3525');
  });
});
