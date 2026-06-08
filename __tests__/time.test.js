/* global describe, expect, it */

const { parseCustomTimeFormat } = require('../src/lib/time');

describe('parseCustomTimeFormat', () => {
  it('parses compact XMLTV time with a numeric timezone', () => {
    expect(parseCustomTimeFormat('20250824000000 +0800').toISOString()).toBe(
      '2025-08-23T16:00:00.000Z',
    );
  });

  it('parses compact XMLTV time without a timezone', () => {
    expect(parseCustomTimeFormat('20250824000000').getFullYear()).toBe(2025);
  });
});
