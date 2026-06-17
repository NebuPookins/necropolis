import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import type { DiscordUser, EnrichedDiscordUser, EnrichedServer, ManualEntry, ManualMap, ProgressInfo, Server } from './types';
import { Store } from './store';
import { parseDiscordExport } from './parser';
import { computeDeadness, computeSparkPotential, deadnessTier, sparkTier, fmtDate, fmtAgo, SPARK_SCALE_FACTOR, MS_PER_DAY } from './metrics';
import './styles.css';

// =========================================================================
// HEADER
// =========================================================================
interface HeaderProps {
  stats: { total: number; reviewed: number; keep: number; leave: number };
  importedAt: number | null;
}

function Header({ stats, importedAt }: HeaderProps) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="display-font" style={{ fontSize: 28, color: 'var(--amber)', letterSpacing: '0.05em' }}>
              necropolis
            </div>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              discord server audit · personal triage console
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, fontSize: 11, color: 'var(--dim)' }}>
            <Stat k="indexed" v={stats.total} />
            <Stat k="reviewed" v={stats.reviewed} accent={stats.reviewed > 0} />
            <Stat k="keep" v={stats.keep} color="var(--green)" />
            <Stat k="leave" v={stats.leave} color="var(--red)" />
            <Stat k="data" v={importedAt ? fmtDate(importedAt) : '—'} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatProps {
  k: string;
  v: number | string;
  color?: string;
  accent?: boolean;
}

function Stat({ k, v, color }: StatProps) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{k}</div>
      <div style={{ fontSize: 16, color: color || 'var(--bright)', fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  );
}

// =========================================================================
// UPLOAD
// =========================================================================
interface UploadCardProps {
  onFile: (file: File) => void;
  parsing: boolean;
  progress: ProgressInfo | null;
}

function UploadCard({ onFile, parsing, progress }: UploadCardProps) {
  const [drag, setDrag] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div style={{ position: 'relative', padding: 32 }}
         className={`file-drop ${drag ? 'dragging' : ''} corner-tl corner-tr corner-bl corner-br`}
         onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
         onDragLeave={() => setDrag(false)}
         onDrop={onDrop}>
      <div style={{ textAlign: 'center' }}>
        <div className="display-font" style={{ fontSize: 18, color: 'var(--amber)', marginBottom: 8 }}>
          [ load data export ]
        </div>
        <div style={{ color: 'var(--mid)', fontSize: 12, marginBottom: 20, lineHeight: 1.7 }}>
          drop your discord <span style={{color:'var(--bright)'}}>package.zip</span> here, or click to browse.<br/>
          request it at: <span style={{color:'var(--amber)'}}>settings → privacy &amp; safety → request all of my data</span><br/>
          discord emails the link in 1–30 days. nothing leaves your browser.
        </div>
        {!parsing && (
          <button className="btn-amber" onClick={() => inp.current?.click()}>
            select package.zip
          </button>
        )}
        <input ref={inp} type="file" accept=".zip" style={{ display: 'none' }}
               onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {parsing && (
          <div style={{ marginTop: 16 }}>
            <div className="blink" style={{ color: 'var(--amber)', fontSize: 12 }}>
              ▸ parsing — {progress?.detail || 'working'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// SERVER ROW
// =========================================================================
interface ServerRowProps {
  s: EnrichedServer;
  expanded: boolean;
  onExpand: () => void;
  onUpdate: (patch: Partial<ManualEntry>) => void;
  now: number;
}

function ServerRow({ s, expanded, onExpand, onUpdate, now }: ServerRowProps) {
  const tier = deadnessTier(s.deadness);
  const decision = s.manual.decision || 'undecided';
  const refDate = s.manual.manualActivityAt
    ? new Date(s.manual.manualActivityAt).getTime()
    : s.myLastMsg;

  return (
    <div className="row-border" style={{ background: expanded ? 'var(--bg-1)' : 'transparent' }}>
      <div className="grid-rows" style={{ cursor: 'pointer' }} onClick={onExpand}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{
              fontSize: 9, padding: '1px 6px', color: tier.color,
              border: `1px solid ${tier.bg}`, letterSpacing: '0.1em', flexShrink: 0,
            }}>{tier.label}</span>
            <span style={{
              color: decision === 'leave' ? 'var(--dim)' : 'var(--bright)',
              textDecoration: decision === 'leave' ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontWeight: decision === 'keep' ? 600 : 400,
            }}>{s.name}</span>
            {decision === 'keep' && <span style={{color:'var(--green)', fontSize:11}}>★</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2, fontFamily: 'monospace' }}>
            {s.id}
          </div>
        </div>
        <div style={{ color: 'var(--mid)', fontSize: 11 }} className="col-hide">
          <div style={{ color: 'var(--fg)' }}>{fmtDate(refDate)}</div>
          <div style={{ fontSize: 10, color: 'var(--dim)' }}>
            {fmtAgo(refDate, now)} ago{s.manual.manualActivityAt ? ' (manual)' : ''}
          </div>
        </div>
        <div style={{ color: 'var(--fg)', fontSize: 12 }} className="col-hide">{s.myMsgCount}</div>
        <div className="col-hide">
          <CareIndicator value={s.manual.care ?? 3} />
        </div>
        <div className="col-hide">
          <DecisionPill decision={decision} />
        </div>
        <div className="col-hide">
          <div style={{ fontSize: 13, color: tier.color, fontWeight: 600 }}>
            {Math.round(s.deadness)}
          </div>
          <div className="deadness-bar" style={{ marginTop: 3 }}>
            <div style={{
              width: `${Math.min(100, s.deadness / 8)}%`,
              background: tier.color,
            }} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && <ExpandedPanel s={s} onUpdate={onUpdate} />}
    </div>
  );
}

function CareIndicator({ value }: { value: number }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1,2,3,4,5].map(n => (
        <div key={n} style={{
          width: 6, height: 10,
          background: n <= value ? 'var(--amber)' : 'var(--bg-3)',
        }} />
      ))}
    </div>
  );
}

function DecisionPill({ decision }: { decision: string }) {
  const map: Record<string, { c: string; l: string }> = {
    keep: { c: 'var(--green)', l: 'KEEP' },
    leave: { c: 'var(--red)', l: 'LEAVE' },
    undecided: { c: 'var(--dim)', l: '—' },
  };
  const d = map[decision] || map['undecided'];
  return (
    <span style={{
      fontSize: 10, color: d.c, letterSpacing: '0.15em',
    }}>{d.l}</span>
  );
}

// =========================================================================
// EXPANDED EDIT PANEL
// =========================================================================
interface ExpandedPanelProps {
  s: EnrichedServer;
  onUpdate: (patch: Partial<ManualEntry>) => void;
}

function ExpandedPanel({ s, onUpdate }: ExpandedPanelProps) {
  const m = s.manual;
  const careLabels = ['leaving', 'meh', 'neutral', 'value', 'essential'];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{
      padding: '16px 24px 20px',
      background: 'var(--bg-1)',
      borderTop: '1px solid var(--line)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 24,
    }}>
      <div>
        <SectionTitle>extracted from export</SectionTitle>
        <DataRow k="my last msg" v={fmtDate(s.myLastMsg)} />
        <DataRow k="my first msg" v={fmtDate(s.myFirstMsg)} />
        <DataRow k="my msg count" v={s.myMsgCount} />
        <DataRow k="channels w/ my msgs" v={s.channelCount} />

        <SectionTitle style={{ marginTop: 20 }}>how much do you care?</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 16, lineHeight: 1 }}
                  disabled={(m.care ?? 3) <= 1}
                  onClick={() => onUpdate({ care: Math.max(1, (m.care ?? 3) - 1) })}>−</button>
          <CareIndicator value={m.care ?? 3} />
          <span style={{ color: 'var(--amber)', minWidth: 65, fontSize: 11 }}>
            {careLabels[(m.care ?? 3) - 1]}
          </span>
          <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 16, lineHeight: 1 }}
                  disabled={(m.care ?? 3) >= 5}
                  onClick={() => onUpdate({ care: Math.min(5, (m.care ?? 3) + 1) })}>+</button>
        </div>

        <SectionTitle style={{ marginTop: 20 }}>decision</SectionTitle>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className={`btn-green ${m.decision === 'keep' ? 'btn-active' : ''}`}
                  onClick={() => onUpdate({ decision: m.decision === 'keep' ? 'undecided' : 'keep' })}>
            ★ keep
          </button>
          <button className={`btn-red ${m.decision === 'leave' ? 'btn-active' : ''}`}
                  onClick={() => onUpdate({ decision: m.decision === 'leave' ? 'undecided' : 'leave' })}>
            ✕ leave
          </button>
        </div>
      </div>

      <div>
        <SectionTitle>manual: when did you last check the server?</SectionTitle>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <input type="date" value={m.manualActivityAt || ''}
                 max={today}
                 onChange={(e) => onUpdate({ manualActivityAt: e.target.value || null })}
                 style={{ background: 'var(--bg-2)' }} />
          <button onClick={() => onUpdate({ manualActivityAt: today })}>today</button>
          {m.manualActivityAt && (
            <button onClick={() => onUpdate({ manualActivityAt: null })}
                    style={{ borderColor: 'var(--line)' }}>clear</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>
          set this to the date of the most recent message you saw in the server when you opened it.
          overrides "my last msg" for the deadness calculation.
        </div>

        <SectionTitle style={{ marginTop: 20 }}>notes</SectionTitle>
        <textarea value={m.notes || ''}
                  onChange={(e) => onUpdate({ notes: e.target.value })}
                  placeholder="why you joined, who runs it, what's left worth keeping…" />

        <div style={{ marginTop: 14, fontSize: 10, color: 'var(--dim)', fontFamily: 'monospace', lineHeight: 1.6 }}>
          deadness: <span style={{color:'var(--bright)'}}>{Math.round(s.deadness)}</span>
          {' = '}
          <span title="days since last engagement">{Math.round(s.deadness * Math.log(s.myMsgCount + 2) / ((6 - (m.care ?? 3))/3))}d</span>
          {' / '}
          <span title="log volume dampener">log({s.myMsgCount}+2)</span>
          {' × '}
          <span title="care multiplier">(6−{m.care ?? 3})/3</span>
        </div>
      </div>
    </div>
  );
}

interface SectionTitleProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

function SectionTitle({ children, style }: SectionTitleProps) {
  return (
    <div style={{
      fontSize: 9, letterSpacing: '0.2em', color: 'var(--amber)',
      textTransform: 'uppercase', marginBottom: 4, ...style,
    }}>
      ▸ {children}
    </div>
  );
}

function DataRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ color: 'var(--mid)', fontSize: 11 }}>{k}</span>
      {typeof v === 'string' || typeof v === 'number' ? (
        <span style={{ color: 'var(--bright)', fontSize: 12, fontFamily: 'monospace' }}>{v}</span>
      ) : v}
    </div>
  );
}

// =========================================================================
// TAB BAR
// =========================================================================
interface TabBarProps {
  tab: 'servers' | 'users';
  onTab: (t: 'servers' | 'users') => void;
  serverCount: number;
  userCount: number;
}

function TabBar({ tab, onTab, serverCount, userCount }: TabBarProps) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)' }}>
      <TabButton active={tab === 'servers'} onClick={() => onTab('servers')}>
        ⌨ servers ({serverCount})
      </TabButton>
      <TabButton active={tab === 'users'} onClick={() => onTab('users')}>
        👤 users ({userCount})
      </TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 20px', fontSize: 11, letterSpacing: '0.1em',
      border: 'none', borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
      color: active ? 'var(--amber)' : 'var(--dim)',
      background: active ? 'var(--bg-1)' : 'transparent',
      fontWeight: active ? 600 : 400,
      borderRadius: 0,
    }}>{children}</button>
  );
}

// =========================================================================
// USER ROW
// =========================================================================
interface UserRowProps {
  u: EnrichedDiscordUser;
  onClick: () => void;
  onUpdate: (patch: Partial<ManualEntry>) => void;
  now: number;
}

function UserRow({ u, onClick, onUpdate, now }: UserRowProps) {
  const tier = sparkTier(u.sparkPotential);
  const decision = u.manual.decision || 'undecided';
  const refDate = u.manual.manualActivityAt
    ? new Date(u.manual.manualActivityAt).getTime()
    : u.myLastMsg;

  return (
    <div className="row-border">
      <div className="grid-rows" style={{ cursor: 'pointer' }} onClick={onClick}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{
              fontSize: 9, padding: '1px 6px', color: tier.color,
              border: `1px solid ${tier.bg}`, letterSpacing: '0.1em', flexShrink: 0,
            }}>{tier.label}</span>
            <span style={{
              color: decision === 'leave' ? 'var(--dim)' : 'var(--bright)',
              textDecoration: decision === 'leave' ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontWeight: decision === 'keep' ? 600 : 400,
            }}>{u.manual.name || u.name}</span>
            {decision === 'keep' && <span style={{color:'var(--green)', fontSize:11}}>★</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2, fontFamily: 'monospace' }}>
            {u.id}
          </div>
        </div>
        <div style={{ color: 'var(--mid)', fontSize: 11 }} className="col-hide">
          <div style={{ color: 'var(--fg)' }}>{fmtDate(refDate)}</div>
          <div style={{ fontSize: 10, color: 'var(--dim)' }}>
            {fmtAgo(refDate, now)} ago
          </div>
        </div>
        <div style={{ color: 'var(--fg)', fontSize: 12 }} className="col-hide">{u.myMsgCount}</div>
        <div className="col-hide">
          <CareIndicator value={u.manual.care ?? 3} />
        </div>
        <div className="col-hide">
          <DecisionPill decision={decision} />
        </div>
        <div className="col-hide">
          <div style={{ fontSize: 13, color: tier.color, fontWeight: 600 }}>
            {Math.round(u.sparkPotential)}
          </div>
          <div className="deadness-bar" style={{ marginTop: 3 }}>
            <div style={{
              width: `${Math.min(100, u.sparkPotential / 3)}%`,
              background: tier.color,
            }} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>open ▸</span>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// USER EXPANDED EDIT PANEL
// =========================================================================
interface UserExpandedPanelProps {
  u: EnrichedDiscordUser;
  onUpdate: (patch: Partial<ManualEntry>) => void;
  now: number;
}

function UserExpandedPanel({ u, onUpdate, now }: UserExpandedPanelProps) {
  const m = u.manual;
  const careLabels = ['leaving', 'meh', 'neutral', 'value', 'essential'];
  const today = new Date().toISOString().slice(0, 10);
  const myFmt = (ms: number | null) => ms ? fmtDate(ms) : '—';
  const channelLink = u.lastChannelId
    ? `https://discord.com/channels/@me/${u.lastChannelId}`
    : null;

  return (
    <div style={{
      padding: '16px 24px 20px',
      background: 'var(--bg-1)',
      borderTop: '1px solid var(--line)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 24,
    }}>
      <div>
        <SectionTitle>extracted from export</SectionTitle>
        <DataRow k="last msg" v={myFmt(u.myLastMsg)} />
        <DataRow k="msg count" v={u.myMsgCount} />
        {channelLink && (
          <div style={{ marginTop: 8 }}>
            <a href={channelLink} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--amber)', fontSize: 11, textDecoration: 'underline' }}>
              ▸ open dm channel in discord
            </a>
          </div>
        )}

        {u.recentMsgs && u.recentMsgs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--mid)', textTransform: 'uppercase', marginBottom: 4 }}>
              ▸ last {u.recentMsgs.length} messages
            </div>
            {[...u.recentMsgs].reverse().map((m, i) => (
              <div key={i} style={{
                padding: '6px 8px', marginBottom: 4,
                background: 'var(--bg-2)', borderRadius: 2,
                fontSize: 11, lineHeight: 1.4,
                borderLeft: '2px solid var(--line-2)',
              }}>
                <div style={{ color: 'var(--dim)', fontSize: 9, marginBottom: 2 }}>
                  {fmtDate(m.ts)} ({fmtAgo(m.ts, now)} ago)
                </div>
                <div style={{ color: 'var(--fg)', wordBreak: 'break-word' }}>
                  {m.content || <span style={{color:'var(--dim)', fontStyle:'italic'}}>(attachment or empty)</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <SectionTitle style={{ marginTop: 20 }}>how much do you care?</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 16, lineHeight: 1 }}
                  disabled={(m.care ?? 3) <= 1}
                  onClick={() => onUpdate({ care: Math.max(1, (m.care ?? 3) - 1) })}>−</button>
          <CareIndicator value={m.care ?? 3} />
          <span style={{ color: 'var(--amber)', minWidth: 65, fontSize: 11 }}>
            {careLabels[(m.care ?? 3) - 1]}
          </span>
          <button style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 16, lineHeight: 1 }}
                  disabled={(m.care ?? 3) >= 5}
                  onClick={() => onUpdate({ care: Math.min(5, (m.care ?? 3) + 1) })}>+</button>
        </div>

        <SectionTitle style={{ marginTop: 20 }}>decision</SectionTitle>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className={`btn-green ${m.decision === 'keep' ? 'btn-active' : ''}`}
                  onClick={() => onUpdate({ decision: m.decision === 'keep' ? 'undecided' : 'keep' })}>
            ★ keep
          </button>
          <button className={`btn-red ${m.decision === 'leave' ? 'btn-active' : ''}`}
                  onClick={() => onUpdate({ decision: m.decision === 'leave' ? 'undecided' : 'leave' })}>
            ✕ leave
          </button>
        </div>
      </div>

      <div>
        <SectionTitle>display name</SectionTitle>
        <input type="text" value={u.manual.name ?? ''}
               onChange={(e) => onUpdate({ name: e.target.value || undefined })}
               placeholder={u.name}
               style={{ background: 'var(--bg-2)', marginTop: 6 }} />
        <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>
          custom name — overrides the auto-generated "{u.name}". leave blank to keep the default.
        </div>

        <SectionTitle style={{ marginTop: 20 }}>manual: when did you last check in?</SectionTitle>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <input type="date" value={m.manualActivityAt || ''}
                 max={today}
                 onChange={(e) => onUpdate({ manualActivityAt: e.target.value || null })}
                 style={{ background: 'var(--bg-2)' }} />
          <button onClick={() => onUpdate({ manualActivityAt: today })}>today</button>
          {m.manualActivityAt && (
            <button onClick={() => onUpdate({ manualActivityAt: null })}
                    style={{ borderColor: 'var(--line)' }}>clear</button>
          )}
        </div>

        <SectionTitle style={{ marginTop: 20 }}>last searched, not found</SectionTitle>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <input type="date" value={m.lastSearchedNotFoundAt || ''}
                 max={today}
                 onChange={(e) => onUpdate({ lastSearchedNotFoundAt: e.target.value || null })}
                 style={{ background: 'var(--bg-2)' }} />
          <button onClick={() => onUpdate({ lastSearchedNotFoundAt: today })}>today</button>
          {m.lastSearchedNotFoundAt && (
            <button onClick={() => onUpdate({ lastSearchedNotFoundAt: null })}
                    style={{ borderColor: 'var(--line)' }}>clear</button>
          )}
        </div>

        <SectionTitle style={{ marginTop: 20 }}>notes</SectionTitle>
        <textarea value={m.notes || ''}
                  onChange={(e) => onUpdate({ notes: e.target.value })}
                  placeholder="who they are, why you fell out of touch…" />

        <div style={{ marginTop: 14, fontSize: 10, color: 'var(--dim)', fontFamily: 'monospace', lineHeight: 1.6 }}>
          {(() => {
            // Determine the actual days value that resolveDaysSinceActivity used
            let displayRefMs: number | null = null;
            if (m.manualActivityAt) {
              const t = new Date(m.manualActivityAt).getTime();
              if (!isNaN(t)) displayRefMs = t;
            }
            if (displayRefMs === null) displayRefMs = u.myLastMsg;
            const displayDays = displayRefMs !== null
              ? Math.round((now - displayRefMs) / MS_PER_DAY)
              : null;
            const daysStr = displayDays !== null ? `${displayDays}d` : '∞';

            return <>
              spark: <span style={{color:'var(--bright)'}}>{Math.round(u.sparkPotential)}</span>
              {' = '}
              <span title="log volume">log({u.myMsgCount}+2)</span>
              {' × '}
              <span title="time factor: 1 - e^(-days/365)">1−e<sup>−{daysStr}/365</sup></span>
              {' × '}
              <span title="care factor">(0.2 + {m.care ?? 3}/3 × 0.8)</span>
              {' × '}{SPARK_SCALE_FACTOR}
              {m.lastSearchedNotFoundAt && (() => {
                const t = new Date(m.lastSearchedNotFoundAt).getTime();
                if (isNaN(t)) return null;
                const d = Math.max(0, (now - t) / MS_PER_DAY);
                if (d < 90) return <span style={{color: 'var(--orange)'}}> × <span title="not-found within 90 days → zero">ZERO</span></span>;
                if (d < 365) return <span> × <span title="partial not-found penalty">{Math.round((d - 90) / (365 - 90) * 100)}% recovered</span></span>;
                return null;
              })()}
            </>;
          })()}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// USER MODAL
// =========================================================================
interface UserModalProps {
  user: EnrichedDiscordUser;
  onClose: () => void;
  onUpdate: (patch: Partial<ManualEntry>) => void;
  now: number;
}

function UserModal({ user, onClose, onUpdate, now }: UserModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const tier = sparkTier(user.sparkPotential);

  return (
    <div ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 24px',
      }}>
      <div style={{
        background: 'var(--bg-0)', border: '1px solid var(--line)',
        maxWidth: 900, width: '100%', maxHeight: 'calc(100vh - 80px)',
        overflow: 'auto', position: 'relative',
      }} className="scroll-thin">
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 24px', background: 'var(--bg-0)',
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 9, padding: '1px 6px', color: tier.color,
              border: `1px solid ${tier.bg}`, letterSpacing: '0.1em',
            }}>{tier.label}</span>
            <span style={{
              color: user.manual.decision === 'leave' ? 'var(--dim)' : 'var(--bright)',
              textDecoration: user.manual.decision === 'leave' ? 'line-through' : 'none',
              fontWeight: user.manual.decision === 'keep' ? 600 : 400,
            }}>{user.manual.name || user.name}</span>
            <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'monospace' }}>{user.id}</span>
          </div>
          <button onClick={onClose}
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 16, lineHeight: 1, border: 'none', background: 'transparent', color: 'var(--dim)', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
        <UserExpandedPanel u={user} onUpdate={onUpdate} now={now} />
      </div>
    </div>
  );
}

// =========================================================================
// FILTERS
// =========================================================================
interface FilterState {
  search: string;
  hideDecided: boolean;
  onlyUnreviewed: boolean;
}

interface FilterBarProps {
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  count: number;
  total: number;
}

function FilterBar({ filter, setFilter, count, total }: FilterBarProps) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center', padding: '14px 24px',
      borderBottom: '1px solid var(--line)', flexWrap: 'wrap',
    }}>
      <input
        type="text" placeholder="search…"
        value={filter.search}
        onChange={(e) => setFilter({ ...filter, search: e.target.value })}
        style={{ flex: '1 1 200px', maxWidth: 320, background: 'var(--bg-2)' }}
      />
      <button onClick={() => setFilter({ ...filter, hideDecided: !filter.hideDecided })}
              className={filter.hideDecided ? 'btn-active' : ''}>
        {filter.hideDecided ? '◉' : '○'} hide decided
      </button>
      <button onClick={() => setFilter({ ...filter, onlyUnreviewed: !filter.onlyUnreviewed })}
              className={filter.onlyUnreviewed ? 'btn-active' : ''}>
        {filter.onlyUnreviewed ? '◉' : '○'} only unreviewed
      </button>
      <span style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: 11 }}>
        {count} / {total}
      </span>
    </div>
  );
}

// =========================================================================
// FOOTER ACTIONS
// =========================================================================
interface FooterActionsProps {
  onReplaceData: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onResetManual: () => void;
  onResetAll: () => void;
}

function FooterActions({ onReplaceData, onExport, onImport, onResetManual, onResetAll }: FooterActionsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{
      padding: '16px 24px', borderTop: '1px solid var(--line)',
      display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onReplaceData}>↻ load new export</button>
        <button onClick={onExport}>↓ export state.json</button>
        <button onClick={() => fileRef.current?.click()}>↑ import state.json</button>
        <input type="file" accept=".json" ref={fileRef} style={{ display: 'none' }}
               onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onResetManual} className="btn-red">reset manual data</button>
        <button onClick={onResetAll} className="btn-red">wipe everything</button>
      </div>
    </div>
  );
}

// =========================================================================
// MAIN APP
// =========================================================================
export function App() {
  const [servers, setServers] = useState<Server[]>([]);
  const [users, setUsers] = useState<DiscordUser[]>([]);
  const [manual, setManual] = useState<ManualMap>({});
  const [userManual, setUserManual] = useState<ManualMap>({});
  const [importedAt, setImportedAt] = useState<number | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<'servers' | 'users'>('servers');

  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showLoader, setShowLoader] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<FilterState>({ search: '', hideDecided: false, onlyUnreviewed: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalUserId, setModalUserId] = useState<string | null>(null);

  // Focus the scrollable container on scroll keys so the browser handles scrolling natively
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      scrollRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    (async () => {
      const [s, u, m, um, im, iss] = await Promise.all([
        Store.get<Server[]>('servers', []),
        Store.get<DiscordUser[]>('users', []),
        Store.get<ManualMap>('manual', {}),
        Store.get<ManualMap>('userManual', {}),
        Store.get<number | null>('importedAt', null),
        Store.get<string[]>('issues', []),
      ]);
      setServers(s);
      setUsers(u);
      setManual(m);
      setUserManual(um);
      setImportedAt(im);
      setIssues(iss);
      setHydrated(true);
    })();
  }, []);

  const handleFile = async (file: File) => {
    setParsing(true);
    setParseError(null);
    setProgress({ stage: 'start', detail: 'reading file' });
    try {
      const result = await parseDiscordExport(file, setProgress);
      setServers(result.servers);
      setUsers(result.users);
      setImportedAt(result.importedAt);
      setIssues(result.issues);
      await Store.set('servers', result.servers);
      await Store.set('users', result.users);
      await Store.set('importedAt', result.importedAt);
      await Store.set('issues', result.issues);
      setShowLoader(false);
    } catch (e) {
      console.error(e);
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const updateManual = useCallback(async (id: string, patch: Partial<ManualEntry>) => {
    setManual(prev => {
      const cur = prev[id] || { care: 3, decision: 'undecided' as const };
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      const all = { ...prev, [id]: next };
      Store.set('manual', all);
      return all;
    });
  }, []);

  const updateUserManual = useCallback(async (id: string, patch: Partial<ManualEntry>) => {
    setUserManual(prev => {
      const cur = prev[id] || { care: 3, decision: 'undecided' as const };
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      const all = { ...prev, [id]: next };
      Store.set('userManual', all);
      return all;
    });
  }, []);

  const exportState = () => {
    const payload = { servers, users, manual, userManual, importedAt, exportedAt: Date.now(), version: 2 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `discord-audit-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importState = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as { servers?: Server[]; users?: DiscordUser[]; manual?: ManualMap; userManual?: ManualMap; importedAt?: number };
      if (!data.servers || !data.manual) throw new Error('bad shape');
      setServers(data.servers);
      setUsers(data.users ?? []);
      setManual(data.manual);
      setUserManual(data.userManual ?? {});
      setImportedAt(data.importedAt || Date.now());
      await Store.set('servers', data.servers);
      await Store.set('users', data.users ?? []);
      await Store.set('manual', data.manual);
      await Store.set('userManual', data.userManual ?? {});
      await Store.set('importedAt', data.importedAt || Date.now());
    } catch (e) {
      alert('import failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const resetManual = async () => {
    if (!confirm('Reset all manual entries? This wipes care scores, decisions, notes, and manual activity dates. Server and user data from the export is kept.')) return;
    setManual({});
    setUserManual({});
    await Store.set('manual', {});
    await Store.set('userManual', {});
  };

  const wipeAll = async () => {
    if (!confirm('Wipe everything? This removes all data including the parsed export. Cannot be undone.')) return;
    setServers([]); setUsers([]); setManual({}); setUserManual({}); setImportedAt(null); setIssues([]);
    await Store.del('servers'); await Store.del('users'); await Store.del('manual'); await Store.del('userManual'); await Store.del('importedAt'); await Store.del('issues');
  };

  const now = Date.now();

  const enriched = useMemo((): EnrichedServer[] => {
    return servers.map(s => ({
      ...s,
      manual: manual[s.id] || { care: 3, decision: 'undecided' as const },
      deadness: computeDeadness(s, manual[s.id], now),
    }));
  }, [servers, manual, now]);

  const enrichedUsers = useMemo((): EnrichedDiscordUser[] => {
    return users.map(u => ({
      ...u,
      manual: userManual[u.id] || { care: 3, decision: 'undecided' as const },
      sparkPotential: computeSparkPotential(u, userManual[u.id], now),
    }));
  }, [users, userManual, now]);

  const visible = useMemo(() => {
    let list = enriched;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.id.includes(q));
    }
    if (filter.hideDecided) {
      list = list.filter(s => s.manual.decision === 'undecided');
    }
    if (filter.onlyUnreviewed) {
      list = list.filter(s => !s.manual.updatedAt);
    }

    const sorter = (a: EnrichedServer, b: EnrichedServer) => {
      const aLeave = a.manual.decision === 'leave';
      const bLeave = b.manual.decision === 'leave';
      if (aLeave !== bLeave) return aLeave ? 1 : -1;
      const careA = a.manual.care ?? 3;
      const careB = b.manual.care ?? 3;
      if (careA !== careB) return careA - careB;
      return b.deadness - a.deadness;
    };
    return [...list].sort(sorter);
  }, [enriched, filter]);

  const visibleUsers = useMemo(() => {
    let list = enrichedUsers;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(u => (u.manual.name || u.name).toLowerCase().includes(q) || u.id.includes(q));
    }
    if (filter.hideDecided) {
      list = list.filter(u => u.manual.decision === 'undecided');
    }
    if (filter.onlyUnreviewed) {
      list = list.filter(u => !u.manual.updatedAt);
    }

    const sorter = (a: EnrichedDiscordUser, b: EnrichedDiscordUser) => {
      const aLeave = a.manual.decision === 'leave';
      const bLeave = b.manual.decision === 'leave';
      if (aLeave !== bLeave) return aLeave ? 1 : -1;
      return b.sparkPotential - a.sparkPotential;
    };
    return [...list].sort(sorter);
  }, [enrichedUsers, filter]);

  const stats = useMemo(() => {
    const total = enriched.length;
    const reviewed = enriched.filter(s => s.manual.updatedAt).length;
    const keep = enriched.filter(s => s.manual.decision === 'keep').length;
    const leave = enriched.filter(s => s.manual.decision === 'leave').length;
    return { total, reviewed, keep, leave };
  }, [enriched]);

  const userStats = useMemo(() => {
    const total = enrichedUsers.length;
    const reviewed = enrichedUsers.filter(u => u.manual.updatedAt).length;
    const keep = enrichedUsers.filter(u => u.manual.decision === 'keep').length;
    const leave = enrichedUsers.filter(u => u.manual.decision === 'leave').length;
    return { total, reviewed, keep, leave };
  }, [enrichedUsers]);

  if (!hydrated) {
    return (
      <div style={{ padding: 40, color: 'var(--dim)' }} className="blink">
        ▸ initializing
      </div>
    );
  }

  const showUploadCard = servers.length === 0 || showLoader;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header stats={tab === 'servers' ? stats : userStats} importedAt={importedAt} />

      <div ref={scrollRef} tabIndex={-1} style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxWidth: 1280, margin: '0 auto', padding: '24px', width: '100%', outline: 'none' }} className="scroll-thin">
        {showUploadCard && (
          <div style={{ marginBottom: 24 }}>
            <UploadCard onFile={handleFile} parsing={parsing} progress={progress} />
            {parseError && (
              <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--red-dim)', color: 'var(--red)', fontSize: 12 }}>
                ✕ parse error: {parseError}
              </div>
            )}
            {servers.length > 0 && !parsing && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button onClick={() => setShowLoader(false)}>cancel — keep existing data</button>
              </div>
            )}
          </div>
        )}

        {servers.length > 0 && !showUploadCard && (
          <div style={{ position: 'relative', border: '1px solid var(--line)' }}
               className="corner-tl corner-tr">
            <TabBar tab={tab} onTab={setTab} serverCount={servers.length} userCount={users.length} />

            <FilterBar
              filter={filter} setFilter={setFilter}
              count={tab === 'servers' ? visible.length : visibleUsers.length}
              total={tab === 'servers' ? servers.length : users.length}
            />

            {tab === 'servers' && (
              <>
                <div className="grid-rows" style={{
                  fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase',
                  letterSpacing: '0.15em', borderBottom: '1px solid var(--line)',
                  background: 'var(--bg-1)',
                }}>
                  <div>server</div>
                  <div className="col-hide">last activity</div>
                  <div className="col-hide">my msgs</div>
                  <div className="col-hide">care</div>
                  <div className="col-hide">decision</div>
                  <div className="col-hide">deadness</div>
                  <div></div>
                </div>
                <div>
                  {visible.map(s => (
                    <ServerRow
                      key={s.id}
                      s={s}
                      expanded={expandedId === s.id}
                      onExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      onUpdate={(patch) => updateManual(s.id, patch)}
                      now={now}
                    />
                  ))}
                  {visible.length === 0 && (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>
                      no servers match the current filters.
                    </div>
                  )}
                </div>
              </>
            )}

            {tab === 'users' && (
              <>
                <div className="grid-rows" style={{
                  fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase',
                  letterSpacing: '0.15em', borderBottom: '1px solid var(--line)',
                  background: 'var(--bg-1)',
                }}>
                  <div>user</div>
                  <div className="col-hide">last activity</div>
                  <div className="col-hide">your msgs</div>
                  <div className="col-hide">care</div>
                  <div className="col-hide">decision</div>
                  <div className="col-hide">spark</div>
                  <div></div>
                </div>
                <div>
                  {visibleUsers.map(u => (
                    <UserRow
                      key={u.id}
                      u={u}
                      onClick={() => setModalUserId(u.id)}
                      onUpdate={(patch) => updateUserManual(u.id, patch)}
                      now={now}
                    />
                  ))}
                  {visibleUsers.length === 0 && (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>
                      no users match the current filters.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {issues.length > 0 && (
          <details style={{ marginTop: 16, padding: 12, border: '1px solid var(--line)', fontSize: 11 }}>
            <summary style={{ color: 'var(--orange)' }}>▸ {issues.length} parsing notice(s) — click</summary>
            <div style={{ marginTop: 8, color: 'var(--dim)', maxHeight: 200, overflowY: 'auto' }}>
              {issues.map((iss, i) => <div key={i}>· {iss}</div>)}
            </div>
          </details>
        )}

        <div style={{
          marginTop: 24, padding: 16, fontSize: 10, color: 'var(--dim)',
          lineHeight: 1.7, borderTop: '1px solid var(--line)',
        }}>
          <div style={{ color: 'var(--amber)', fontSize: 9, letterSpacing: '0.2em', marginBottom: 8 }}>
            ▸ HOW THE SCORE WORKS
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ color: 'var(--mid)' }}>servers</strong>
            <code style={{ color: 'var(--bright)', fontSize: 11, display: 'block', marginTop: 2 }}>
              deadness = days_since_engagement / log(my_msg_count + 2) × (6 − care) / 3
            </code>
            tier cutoffs: alive &lt;30 · quiet &lt;90 · stale &lt;200 · decay &lt;500 · grave ≥500.
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ color: 'var(--mid)' }}>users (spark potential)</strong>
            <code style={{ color: 'var(--bright)', fontSize: 11, display: 'block', marginTop: 2 }}>
              spark = log(your_msg_count + 2) × (1 − e<sup>−days/365</sup>) × (0.2 + care/3 × 0.8) × 50
            </code>
            scores past relationship depth — more messages = stronger foundation to rebuild on.
            long silence is a weak positive signal (it asymptotes after ~2 years).
            if you searched and couldn't find them within the last 90 days, spark is zero.
            tier cutoffs: bright ≥150 · warm ≥60 · ember ≥20 · cold ≥5 · frozen &lt;5.
          </div>
        </div>
      </div>

      {servers.length > 0 && !showUploadCard && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--bg-0)' }} className="corner-bl corner-br">
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            <FooterActions
              onReplaceData={() => setShowLoader(true)}
              onExport={exportState}
              onImport={importState}
              onResetManual={resetManual}
              onResetAll={wipeAll}
            />
          </div>
        </div>
      )}

      {modalUserId && (() => {
        const modalUser = enrichedUsers.find(u => u.id === modalUserId);
        if (!modalUser) return null;
        return (
          <UserModal
            key={modalUser.id}
            user={modalUser}
            onClose={() => setModalUserId(null)}
            onUpdate={(patch) => updateUserManual(modalUser.id, patch)}
            now={now}
          />
        );
      })()}
    </div>
  );
}
