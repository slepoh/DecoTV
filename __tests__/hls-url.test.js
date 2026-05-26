/* global describe, expect, it */

const { isLikelyHlsUrl } = require('../src/lib/player/hls-url');

describe('isLikelyHlsUrl', () => {
  it('identifies direct HLS playlists with query parameters', () => {
    expect(
      isLikelyHlsUrl('https://cdn.example.com/video/index.m3u8?token=1'),
    ).toBe(true);
  });

  it('identifies an HLS playlist wrapped by the ad-filter proxy', () => {
    const upstream = 'https://cdn.example.com/video/index.m3u8?token=1';
    const wrapped = `/api/proxy/m3u8-filter?url=${encodeURIComponent(upstream)}&sig=test`;

    expect(isLikelyHlsUrl(wrapped)).toBe(true);
  });

  it('identifies nested HLS proxy playlist requests', () => {
    const variant = 'https://cdn.example.com/video/720p/index.m3u8';
    const wrappedVariant = `/api/proxy/m3u8-filter?url=${encodeURIComponent(variant)}&sig=variant`;
    const wrappedMaster = `/api/proxy/m3u8-filter?url=${encodeURIComponent(wrappedVariant)}&sig=master`;

    expect(isLikelyHlsUrl(wrappedMaster)).toBe(true);
  });

  it('does not route non-HLS media through the HLS loader', () => {
    const upstream = 'https://cdn.example.com/video/movie.mp4';
    const wrapped = `/api/proxy/m3u8-filter?url=${encodeURIComponent(upstream)}&sig=test`;

    expect(isLikelyHlsUrl(wrapped)).toBe(false);
    expect(isLikelyHlsUrl(upstream)).toBe(false);
  });
});
