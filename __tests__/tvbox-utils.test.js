/* global describe, expect, it */

const {
  decodeTvboxId,
  encodeTvboxId,
  getLastNonEmptySearchParam,
} = require('../src/lib/tvbox-utils');

describe('tvbox utils', () => {
  it('uses the last non-empty search keyword when TVBox appends wd twice', () => {
    const params = new URLSearchParams('source=a&wd=&wd=%E6%B5%8B%E8%AF%95');

    expect(getLastNonEmptySearchParam(params, ['wd'])).toBe('测试');
  });

  it('round-trips encoded TVBox ids', () => {
    const payload = {
      kind: 'douban',
      id: '1292052',
      title: '肖申克的救赎',
      rate: '9.7',
    };

    expect(decodeTvboxId(encodeTvboxId(payload))).toEqual(payload);
  });
});
