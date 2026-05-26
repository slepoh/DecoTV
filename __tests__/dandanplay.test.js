/* global describe, expect, it */

const {
  buildDandanplayEpisodeSearchUrl,
  buildDandanplayHeaders,
  generateDandanplaySignature,
} = require('../src/lib/dandanplay');

describe('dandanplay server integration helpers', () => {
  it('generates the documented path-scoped SHA-256 signature', () => {
    expect(
      generateDandanplaySignature(
        'app_id',
        'app_secret',
        '/api/v2/comment/123',
        1700000000,
      ),
    ).toBe('ReMY81jUt/5ZR3YWs34eJTHsrLRcGARLrhY6fiQSh7Q=');
  });

  it('sends a signature instead of exposing the AppSecret header', () => {
    const headers = buildDandanplayHeaders(
      'app_id',
      'app_secret',
      '/api/v2/comment/123',
      1700000000,
    );

    expect(headers['X-AppId']).toBe('app_id');
    expect(headers['X-Timestamp']).toBe('1700000000');
    expect(headers['X-Signature']).toBe(
      'ReMY81jUt/5ZR3YWs34eJTHsrLRcGARLrhY6fiQSh7Q=',
    );
    expect(headers).not.toHaveProperty('X-AppSecret');
  });

  it('builds a targeted TMDB and episode search request', () => {
    const url = new URL(
      buildDandanplayEpisodeSearchUrl({
        tmdbId: 100049,
        episode: 2,
      }),
    );

    expect(url.pathname).toBe('/api/v2/search/episodes');
    expect(url.searchParams.get('tmdbId')).toBe('100049');
    expect(url.searchParams.get('episode')).toBe('2');
    expect(url.searchParams.has('anime')).toBe(false);
  });
});
