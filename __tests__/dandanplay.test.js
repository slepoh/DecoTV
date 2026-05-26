/* global afterEach, describe, expect, it */

const {
  buildDandanplayEpisodeSearchUrl,
  buildDandanplayHeaders,
  buildDandanplayRelayRequestUrl,
  generateDandanplaySignature,
  getDandanplayRelayOrigin,
  isDandanplayPublicRelayEnabled,
} = require('../src/lib/dandanplay');

describe('dandanplay server integration helpers', () => {
  const originalRelayUrl = process.env.DANDANPLAY_RELAY_URL;
  const originalPublicRelayEnabled =
    process.env.DANDANPLAY_PUBLIC_RELAY_ENABLED;

  afterEach(() => {
    if (originalRelayUrl === undefined) {
      delete process.env.DANDANPLAY_RELAY_URL;
    } else {
      process.env.DANDANPLAY_RELAY_URL = originalRelayUrl;
    }
    if (originalPublicRelayEnabled === undefined) {
      delete process.env.DANDANPLAY_PUBLIC_RELAY_ENABLED;
    } else {
      process.env.DANDANPLAY_PUBLIC_RELAY_ENABLED = originalPublicRelayEnabled;
    }
  });

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

  it('uses the maintainer DecoTV deployment as the default public relay', () => {
    delete process.env.DANDANPLAY_RELAY_URL;

    const relayUrl = new URL(
      buildDandanplayRelayRequestUrl({
        url: 'https://forked-decotv.example/api/danmu-external?title=test&episode=1',
      }),
    );

    expect(getDandanplayRelayOrigin()).toBe('https://tv.katelya.eu.org');
    expect(relayUrl.origin).toBe('https://tv.katelya.eu.org');
    expect(relayUrl.pathname).toBe('/api/danmu-external');
    expect(relayUrl.searchParams.get('episode')).toBe('1');
  });

  it('does not relay back into the managed origin or when explicitly disabled', () => {
    delete process.env.DANDANPLAY_RELAY_URL;
    expect(
      buildDandanplayRelayRequestUrl({
        url: 'https://tv.katelya.eu.org/api/danmu-external?title=test',
      }),
    ).toBeNull();

    process.env.DANDANPLAY_RELAY_URL = 'disabled';
    expect(
      buildDandanplayRelayRequestUrl({
        url: 'https://forked-decotv.example/api/danmu-external?title=test',
      }),
    ).toBeNull();
  });

  it('allows the managed deployment to stop serving public relay traffic', () => {
    delete process.env.DANDANPLAY_PUBLIC_RELAY_ENABLED;
    expect(isDandanplayPublicRelayEnabled()).toBe(true);

    process.env.DANDANPLAY_PUBLIC_RELAY_ENABLED = 'false';
    expect(isDandanplayPublicRelayEnabled()).toBe(false);
  });
});
