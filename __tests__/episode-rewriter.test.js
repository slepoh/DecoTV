/* global afterEach, describe, expect, it, jest */

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

const {
  shouldUseServerSideEpisodeProxy,
} = require('../src/lib/episode-rewriter');

function makeRequest(adfilter) {
  const searchParams = new URLSearchParams();
  if (adfilter !== undefined) {
    searchParams.set('adfilter', adfilter);
  }

  return {
    nextUrl: {
      searchParams,
    },
  };
}

describe('shouldUseServerSideEpisodeProxy', () => {
  const originalEnv = {
    ENABLE_AD_FILTER: process.env.ENABLE_AD_FILTER,
    ENABLE_M3U8_SERVER_PROXY: process.env.ENABLE_M3U8_SERVER_PROXY,
    M3U8_SERVER_PROXY: process.env.M3U8_SERVER_PROXY,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('keeps playback direct by default', () => {
    delete process.env.ENABLE_AD_FILTER;
    delete process.env.ENABLE_M3U8_SERVER_PROXY;
    delete process.env.M3U8_SERVER_PROXY;

    expect(shouldUseServerSideEpisodeProxy(null, makeRequest())).toBe(false);
  });

  it('allows legacy env opt-in for server-side filtering', () => {
    process.env.ENABLE_AD_FILTER = 'true';

    expect(shouldUseServerSideEpisodeProxy(null, makeRequest())).toBe(true);
  });

  it('lets explicit proxy env override admin defaults', () => {
    process.env.M3U8_SERVER_PROXY = 'false';

    expect(
      shouldUseServerSideEpisodeProxy(
        { AdFilterConfig: { enabled: true } },
        makeRequest(),
      ),
    ).toBe(false);
  });

  it('lets the request force proxy or direct mode', () => {
    expect(shouldUseServerSideEpisodeProxy(null, makeRequest('server'))).toBe(
      true,
    );
    expect(
      shouldUseServerSideEpisodeProxy(
        { AdFilterConfig: { enabled: true } },
        makeRequest('direct'),
      ),
    ).toBe(false);
  });
});
