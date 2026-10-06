import { describe, it, expect } from 'vitest';
import { computeDeadness, computeSparkPotential, localDateString, resolveLastActivity } from './metrics';

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
    expect(distant.score).toBeGreaterThan(recent.score);
  });

  it('10 messages / 2mo silence ranks above a billion messages / 1mo silence', () => {
    const a = computeSparkPotential(user(1_000_000_000, 30), undefined, NOW);
    const b = computeSparkPotential(user(10, 60), undefined, NOW);
    expect(b.score).toBeGreaterThan(a.score);
  });

  it('234 messages / 61 days ranks above 810 messages / 53 days (longer silence despite lower volume)', () => {
    const a = computeSparkPotential(user(810, 53), undefined, NOW);
    const b = computeSparkPotential(user(234, 61), undefined, NOW);
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe('localDateString', () => {
  it('uses the local calendar date late in the evening', () => {
    expect(localDateString(new Date(2026, 9, 2, 23, 30).getTime())).toBe('2026-10-02');
  });

  it('uses the local calendar date early in the morning', () => {
    expect(localDateString(new Date(2026, 0, 5, 0, 30).getTime())).toBe('2026-01-05');
  });
});

describe('resolveLastActivity', () => {
  const isoDaysAgo = (days: number) => new Date(msAgo(days)).toISOString();

  it('uses the manual date when it is newer than the last exported message', () => {
    expect(resolveLastActivity(isoDaysAgo(5), msAgo(40))).toEqual({ at: msAgo(5), source: 'manual' });
  });

  it('uses the last exported message when it is newer than a stale manual date', () => {
    expect(resolveLastActivity(isoDaysAgo(200), msAgo(3))).toEqual({ at: msAgo(3), source: 'export' });
  });

  it('falls back to the exported message when the manual date is missing or invalid', () => {
    expect(resolveLastActivity(null, msAgo(3))).toEqual({ at: msAgo(3), source: 'export' });
    expect(resolveLastActivity('not a date', msAgo(3))).toEqual({ at: msAgo(3), source: 'export' });
  });

  it('uses the manual date when there are no exported messages', () => {
    expect(resolveLastActivity(isoDaysAgo(5), null)).toEqual({ at: msAgo(5), source: 'manual' });
  });

  it('is null with no activity at all', () => {
    expect(resolveLastActivity(undefined, null)).toBeNull();
  });
});

describe('stale manual activity dates', () => {
  const server = {
    id: '1', name: 's', myLastMsg: msAgo(3), myFirstMsg: msAgo(300), myMsgCount: 50, channelCount: 1,
  };
  const staleManual = { manualActivityAt: new Date(msAgo(200)).toISOString() };

  it('do not make a server with newer exported messages look deader', () => {
    expect(computeDeadness(server, staleManual, NOW)).toBe(computeDeadness(server, undefined, NOW));
  });

  it('do not inflate spark potential for a user with newer exported messages', () => {
    const u = user(5, 3);
    expect(computeSparkPotential(u, staleManual, NOW).score)
      .toBe(computeSparkPotential(u, undefined, NOW).score);
  });
});
