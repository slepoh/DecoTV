/* global describe, expect, it */

const {
  buildResolutionFilterFromSearchParams,
  filterSearchResultsByResolution,
  inferResolutionLevelFromText,
  normalizeResolutionLevel,
} = require('../src/lib/video-quality');

describe('video quality helpers', () => {
  it('normalizes common resolution aliases', () => {
    expect(normalizeResolutionLevel('4K')).toBe(2160);
    expect(normalizeResolutionLevel('FHD')).toBe(1080);
    expect(normalizeResolutionLevel('hd')).toBe(720);
    expect(normalizeResolutionLevel('off')).toBe(0);
  });

  it('infers the highest explicit resolution from mixed metadata', () => {
    expect(inferResolutionLevelFromText('HD\u4e2d\u5b57', '1920x1080')).toBe(1080);
    expect(inferResolutionLevelFromText('\u67aa\u7248 TC')).toBe(360);
    expect(inferResolutionLevelFromText('\u84dd\u5149')).toBe(1080);
    expect(inferResolutionLevelFromText('HD中字', '1920x1080')).toBe(1080);
    expect(inferResolutionLevelFromText('枪版 TC')).toBe(360);
    expect(inferResolutionLevelFromText('蓝光')).toBe(1080);
  });

  it('keeps unknown results in non-strict filtering', () => {
    const filter = buildResolutionFilterFromSearchParams(
      new URLSearchParams('minResolution=720'),
    );
    const results = filterSearchResultsByResolution(
      [
        { id: '1', title: 'low', year: '2024', episodes: [], episodes_titles: [], source: 'a', source_name: 'A', poster: '', resolution_level: 480 },
        { id: '2', title: 'unknown', year: '2024', episodes: [], episodes_titles: [], source: 'a', source_name: 'A', poster: '' },
        { id: '3', title: 'high', year: '2024', episodes: [], episodes_titles: [], source: 'a', source_name: 'A', poster: '', resolution_level: 1080 },
      ],
      filter,
    );

    expect(results.map((item) => item.id)).toEqual(['2', '3']);
  });

  it('drops unknown results in strict filtering', () => {
    const filter = buildResolutionFilterFromSearchParams(
      new URLSearchParams('minResolution=720&resolutionStrict=1'),
    );
    const results = filterSearchResultsByResolution(
      [
        { id: '1', title: 'unknown', year: '2024', episodes: [], episodes_titles: [], source: 'a', source_name: 'A', poster: '' },
        { id: '2', title: 'high', year: '2024', episodes: [], episodes_titles: [], source: 'a', source_name: 'A', poster: '', resolution: '1080p' },
      ],
      filter,
    );

    expect(results.map((item) => item.id)).toEqual(['2']);
  });
});
