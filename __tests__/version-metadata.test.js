/* global describe, expect, it */

const {
  compareBuildMetadata,
  compareSemanticVersions,
  timestampFromIso,
} = require('../src/lib/version-metadata');

describe('version metadata comparison', () => {
  it('detects a newer semantic version', () => {
    expect(
      compareBuildMetadata(
        { version: '1.5.0', timestamp: '20260601000000' },
        { version: '1.6.0', timestamp: '20260601000000' },
      ),
    ).toEqual({ hasUpdate: true, reason: 'semantic-version' });
  });

  it('detects a newer commit within the same semantic version', () => {
    expect(
      compareBuildMetadata(
        {
          version: '1.5.0',
          timestamp: '20260601000000',
          commitSha: '1111111111111111111111111111111111111111',
          commitDate: '2026-06-01T00:00:00+08:00',
        },
        {
          version: '1.5.0',
          timestamp: '20260602000000',
          commitSha: '2222222222222222222222222222222222222222',
          commitDate: '2026-06-02T00:00:00+08:00',
        },
      ),
    ).toEqual({ hasUpdate: true, reason: 'commit' });
  });

  it('does not report updates for the same commit', () => {
    expect(
      compareBuildMetadata(
        {
          version: '1.5.0',
          timestamp: '20260601000000',
          commitSha: '1111111111111111111111111111111111111111',
        },
        {
          version: '1.5.0',
          timestamp: '20260602000000',
          commitSha: '1111111111111111111111111111111111111111',
        },
      ),
    ).toEqual({ hasUpdate: false, reason: 'none' });
  });

  it('falls back to timestamps when commit metadata is unavailable', () => {
    expect(
      compareBuildMetadata(
        { version: '1.5.0', timestamp: '20260601000000' },
        { version: '1.5.0', timestamp: '20260602000000' },
      ),
    ).toEqual({ hasUpdate: true, reason: 'timestamp' });
  });

  it('does not let stale remote semantic metadata suppress a newer commit', () => {
    expect(
      compareBuildMetadata(
        {
          version: '1.5.0',
          timestamp: '20260601000000',
          commitSha: '1111111111111111111111111111111111111111',
          commitDate: '2026-06-01T00:00:00+08:00',
        },
        {
          version: '1.4.0',
          timestamp: '20260602000000',
          commitSha: '2222222222222222222222222222222222222222',
          commitDate: '2026-06-02T00:00:00+08:00',
        },
      ),
    ).toEqual({ hasUpdate: true, reason: 'commit' });
  });

  it('normalizes v-prefixed semantic versions and ISO dates', () => {
    expect(compareSemanticVersions('v1.5.0', '1.5.1')).toBe(-1);
    expect(timestampFromIso('2026-06-02T00:00:00+08:00')).toMatch(/^\d{14}$/);
  });
});
