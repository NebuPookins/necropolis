import type { ManualEntry, DeadnessTier, Server, SparkResult, Factor } from './types';

/** Number of milliseconds in a day. */
export const MS_PER_DAY = 86400000;

/** Shared fallback: how many "days since last activity" for someone never messaged. */
const NEVER_MESSAGED_DAYS = 365 * 5;

/** Scale factor applied so spark potential lands in a readable 0-500ish range. */
export const SPARK_SCALE_FACTOR = 50;

/**
 * Resolve the number of days since the user last engaged with this entity.
 * Uses the manual override date if set, otherwise falls back to the last message timestamp.
 */
function resolveDaysSinceActivity(
  manualActivityAt: string | null | undefined,
  myLastMsg: number | null,
  now: number,
): number {
  let refMs: number | null = null;
  if (manualActivityAt) {
    const t = new Date(manualActivityAt).getTime();
    if (!isNaN(t)) refMs = t;
  }
  if (refMs === null) refMs = myLastMsg;
  return refMs === null ? NEVER_MESSAGED_DAYS : Math.max(0, (now - refMs) / MS_PER_DAY);
}

export function computeDeadness(server: Server, manual: ManualEntry | undefined, now: number): number {
  const m = manual || {};
  const days = resolveDaysSinceActivity(m.manualActivityAt, server.myLastMsg, now);
  const volumeDampener = Math.log(server.myMsgCount + 2);
  const care = m.care ?? 3;
  const careMultiplier = (6 - care) / 3;
  return (days / volumeDampener) * careMultiplier;
}

export function computeSparkPotential(
  user: { myLastMsg: number | null; myMsgCount: number },
  manual: ManualEntry | undefined,
  now: number,
): SparkResult {
  const m = manual || {};

  // Not-found penalty: applied as a multiplier on the full formula so the
  // score stays on a consistent scale — no overnight tier jumps.
  let notFoundPenalty = 1;
  let notFoundDays: number | null = null;
  if (m.lastSearchedNotFoundAt) {
    const t = new Date(m.lastSearchedNotFoundAt).getTime();
    if (!isNaN(t)) {
      notFoundDays = Math.max(0, (now - t) / MS_PER_DAY);
      // First 90 days after a failed search → zero (can't re-spark what you can't find).
      if (notFoundDays < 90) notFoundPenalty = 0;
      // Gradual ramp back over the rest of the year.
      else if (notFoundDays < 365) notFoundPenalty = (notFoundDays - 90) / (365 - 90);
      // After 1 year: penalty fully decayed
    }
  }

  const days = resolveDaysSinceActivity(m.manualActivityAt, user.myLastMsg, now);

  // Volume factor: capped at ~10 messages so past a few messages it stops mattering.
  const cappedCount = Math.min(user.myMsgCount, 10);
  const volumeLogArg = cappedCount + 2;
  const volumeFactor = Math.log(volumeLogArg);

  // Time factor: increases from 0 (just talked) toward 1 (years ago).
  const timeFactor = 1 - Math.exp(-days / 365);

  // Care factor: care=1 → ~0.47, care=3 → 1.0, care=5 → ~1.53
  const care = m.care ?? 3;
  const careFactor = 0.2 + (care / 3) * 0.8;

  const factors: Factor[] = [
    {
      label: 'volume',
      expression: 'log(min(msgCount, 10) + 2)',
      expressionInlined: `log(min(${user.myMsgCount}, 10) + 2)`,
      value: volumeFactor,
    },
    {
      label: 'time',
      expression: '1 − exp(−days / 365)',
      expressionInlined: `1 − exp(−${Math.round(days)}d / 365)`,
      value: timeFactor,
    },
    {
      label: 'care',
      expression: '0.2 + care/3 × 0.8',
      expressionInlined: `0.2 + ${care}/3 × 0.8`,
      value: careFactor,
    },
    {
      label: 'scale',
      expression: String(SPARK_SCALE_FACTOR),
      expressionInlined: String(SPARK_SCALE_FACTOR),
      value: SPARK_SCALE_FACTOR,
    },
  ];

  // Only include the not-found penalty when it's actively reducing the score.
  if (notFoundPenalty < 1) {
    let inlined: string;
    if (notFoundPenalty === 0) {
      inlined = 'ZERO';
    } else if (notFoundDays !== null) {
      const pct = Math.round((notFoundDays - 90) / (365 - 90) * 100);
      inlined = `${pct}% recovered`;
    } else {
      inlined = `${Math.round(notFoundPenalty * 100)}%`;
    }
    factors.push({
      label: 'not-found',
      expression: 'not-found penalty',
      expressionInlined: inlined,
      value: notFoundPenalty,
    });
  }

  const score = factors.reduce((acc, f) => acc * f.value, 1);

  return { score, factors };
}

export function sparkTier(score: number): DeadnessTier {
  if (score >= 150) return { label: 'BRIGHT', color: 'var(--green)', bg: 'var(--green-dim)' };
  if (score >= 60) return { label: 'WARM', color: '#a8c97f', bg: '#3a4d24' };
  if (score >= 20) return { label: 'EMBER', color: 'var(--amber)', bg: 'var(--amber-dim)' };
  if (score >= 5) return { label: 'COLD', color: 'var(--orange)', bg: '#7a3a14' };
  return { label: 'FROZEN', color: 'var(--red)', bg: 'var(--red-dim)' };
}

export function deadnessTier(score: number): DeadnessTier {
  if (score < 30) return { label: 'ALIVE', color: 'var(--green)', bg: 'var(--green-dim)' };
  if (score < 90) return { label: 'QUIET', color: '#a8c97f', bg: '#3a4d24' };
  if (score < 200) return { label: 'STALE', color: 'var(--amber)', bg: 'var(--amber-dim)' };
  if (score < 500) return { label: 'DECAY', color: 'var(--orange)', bg: '#7a3a14' };
  return { label: 'GRAVE', color: 'var(--red)', bg: 'var(--red-dim)' };
}

export function fmtDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtAgo(ms: number | null | undefined, now: number): string {
  if (ms === null || ms === undefined) return 'never';
  const days = Math.floor((now - ms) / MS_PER_DAY);
  if (days < 1) return 'today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
