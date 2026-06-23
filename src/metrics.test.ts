import { describe, it, expect } from 'vitest';
import { computeSparkPotential } from './metrics';

const MS_PER_DAY = 86400000;
const NOW = 1_700_000_000_000;
const msAgo = (days: number) => NOW - days * MS_PER_DAY;

function user(myMsgCount: number, myLastMsgDaysAgo: number) {
  return { myMsgCount, myLastMsg: msAgo(myLastMsgDaysAgo) };
}

describe('computeSparkPotential ranking', () => {
  it('longer silence ranks higher when volume and care are equal', () => {
    const recent = computeSparkPotential(user(5, 10), undefined, NOW);
    const distant = computeSparkPotential(user(5, 60), undefined, NOW);
    expect(distant).toBeGreaterThan(recent);
  });

  it('10 messages / 2mo silence ranks above a billion messages / 1mo silence', () => {
    const a = computeSparkPotential(user(1_000_000_000, 30), undefined, NOW);
    const b = computeSparkPotential(user(10, 60), undefined, NOW);
    expect(b).toBeGreaterThan(a);
  });
});
