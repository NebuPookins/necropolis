import type { Server, ManualEntry, DeadnessTier } from './types';

export function computeDeadness(server: Server, manual: ManualEntry | undefined, now: number): number {
  const m = manual || {};

  let refMs: number | null = null;
  if (m.manualActivityAt) {
    const t = new Date(m.manualActivityAt).getTime();
    if (!isNaN(t)) refMs = t;
  }
  if (refMs === null) refMs = server.myLastMsg;

  let days: number;
  if (refMs === null) {
    days = 365 * 5;
  } else {
    days = Math.max(0, (now - refMs) / 86400000);
  }

  const volumeDampener = Math.log(server.myMsgCount + 2);
  const care = m.care ?? 3;
  const careMultiplier = (6 - care) / 3;

  return (days / volumeDampener) * careMultiplier;
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
  const days = Math.floor((now - ms) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
