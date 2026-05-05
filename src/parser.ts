import JSZip from 'jszip';
import type { DiscordUser, Server, ParseResult, ProgressInfo } from './types';

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Find the actual casing of a top-level directory in the zip (e.g. "Messages" vs "messages"). */
function detectDir(zip: JSZip, name: string): string | null {
  const lower = name.toLowerCase();
  let found: string | null = null;
  zip.forEach((path) => {
    const slash = path.indexOf('/');
    if (slash === -1) return;
    const root = path.slice(0, slash);
    if (!found && root.toLowerCase() === lower) found = root;
  });
  return found;
}

export async function parseDiscordExport(
  file: File,
  onProgress?: (p: ProgressInfo) => void,
): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(file);
  onProgress?.({ stage: 'loaded', detail: 'ZIP opened, scanning structure' });

  // Detect actual directory casing from the zip
  const messagesDir = detectDir(zip, 'messages');
  const serversDir = detectDir(zip, 'servers');

  if (!messagesDir) {
    return { servers: [], users: [], issues: ['No Messages/ directory found in the zip'], importedAt: Date.now() };
  }

  const msgPrefix = `${messagesDir}/`;
  const srvPrefix = serversDir ? `${serversDir}/` : null;

  const channelKeys = new Set<string>();
  zip.forEach((path) => {
    const match = path.match(new RegExp(`^${messagesDir}\\/([^/]+)\\/channel\\.json$`));
    if (match) channelKeys.add(match[1]);
  });
  onProgress?.({ stage: 'scan', detail: `${channelKeys.size} channel folders found` });

  const guildMap = new Map<string, Server>();

  if (srvPrefix) {
    const idxFile = zip.file(`${srvPrefix}index.json`);
    if (idxFile) {
      try {
        const data = JSON.parse(await idxFile.async('text')) as Record<string, string>;
        for (const [id, name] of Object.entries(data)) {
          guildMap.set(String(id), {
            id: String(id),
            name: String(name),
            myLastMsg: null,
            myFirstMsg: null,
            myMsgCount: 0,
            channelCount: 0,
          });
        }
        onProgress?.({ stage: 'scan', detail: `${guildMap.size} servers in index` });
      } catch {}
    }
  }

  const userMap = new Map<string, DiscordUser>();

  let channelsWithGuild = 0;
  let channelsSkippedNoGuild = 0;
  let i = 0;
  const issues: string[] = [];
  for (const ck of channelKeys) {
    i++;
    if (i % 4 === 0 || i === channelKeys.size) {
      onProgress?.({ stage: 'parse', detail: `channel ${i} / ${channelKeys.size}` });
      await new Promise(r => setTimeout(r, 0));
    }

    const chanFile = zip.file(`${msgPrefix}${ck}/channel.json`);
    if (!chanFile) continue;

    let chan: {
      id?: unknown;
      guild?: { id: string; name?: string } | null;
      type?: unknown;
      name?: string;
      recipients?: unknown;
    };
    try {
      chan = JSON.parse(await chanFile.async('text')) as typeof chan;
    } catch {
      issues.push(`Bad channel.json in ${ck}`);
      continue;
    }

    if (!chan.guild) {
      const isDm = chan.type === 'DM' || chan.type === 'GROUP_DM';
      const raw = chan.recipients ?? [];
      const hasRecipients = Array.isArray(raw) && raw.length > 0;

      if (isDm && hasRecipients) {
        const recipients: { id: string; name: string }[] = raw.map((r: unknown) => {
          if (typeof r === 'string') {
            const isId = /^\d+$/.test(r);
            return { id: r, name: isId ? `User ${r.slice(-4)}` : r };
          }
          const o = r as Record<string, unknown>;
          return { id: String(o.id ?? o.ID ?? ''), name: String(o.global_name ?? o.username ?? o.id ?? '').slice(0, 60) };
        }).filter(r => r.id);

        const chanId = String(chan.id ?? '').replace(/^c/, '');

        const msgsJson = zip.file(`${msgPrefix}${ck}/messages.json`);
        const msgsCsv = zip.file(`${msgPrefix}${ck}/messages.csv`);

        // Collect per-user message data (this export only has the user's own messages)
        const perUser: Map<string, { tsMax: number; count: number; lastId: string; lastContent: string }> = new Map();
        for (const r of recipients) perUser.set(r.id, { tsMax: 0, count: 0, lastId: '', lastContent: '' });

        // Also collect recent messages from this channel (shared across recipients)
        const MAX_RECENT = 5;
        const channelMsgs: Array<{ ts: number; content: string }> = [];

        if (msgsJson) {
          try {
            // Quote numeric IDs before JSON.parse to avoid precision loss on
            // large Discord snowflakes (> Number.MAX_SAFE_INTEGER)
            const raw = await msgsJson.async('text');
            const fixed = raw.replace(/"ID":\s*(\d{17,})/g, '"ID":"$1"')
                             .replace(/"id":\s*(\d{17,})/g, '"id":"$1"');
            const arr = JSON.parse(fixed) as Record<string, unknown>[];
            if (Array.isArray(arr)) for (const msg of arr) {
              const tsRaw = msg['Timestamp'] ?? msg['timestamp'] ?? msg['created_at'];
              if (!tsRaw) continue;
              const t = new Date(String(tsRaw)).getTime();
              if (isNaN(t)) continue;
              const msgId = String(msg['ID'] ?? msg['id'] ?? '');
              const content = String(msg['Contents'] ?? msg['Content'] ?? msg['content'] ?? '');
              channelMsgs.push({ ts: t, content });
              for (const r of recipients) {
                const d = perUser.get(r.id)!;
                d.count++;
                if (t > d.tsMax) { d.tsMax = t; d.lastId = msgId; d.lastContent = content; }
              }
            }
          } catch { issues.push(`Bad messages.json in DM channel ${ck}`); }
        } else if (msgsCsv) {
          try {
            const text = await msgsCsv.async('text');
            const lines = text.split(/\r?\n/);
            const header = lines[0] ? parseCsvRow(lines[0]) : [];
            const tsIdx = header.findIndex(h => /timestamp/i.test(h));
            const idIdx = header.findIndex(h => /^id$/i.test(h));
            const contentIdx = header.findIndex(h => /contents|content|message/i.test(h));
            if (tsIdx >= 0) {
              for (let j = 1; j < lines.length; j++) {
                if (!lines[j].trim()) continue;
                const cols = parseCsvRow(lines[j]);
                const tsRaw = cols[tsIdx];
                if (!tsRaw) continue;
                const t = new Date(tsRaw).getTime();
                if (isNaN(t)) continue;
                const msgId = idIdx >= 0 ? (cols[idIdx] || '') : '';
                const content = contentIdx >= 0 ? (cols[contentIdx] || '') : '';
                channelMsgs.push({ ts: t, content });
                for (const r of recipients) {
                  const d = perUser.get(r.id)!;
                  d.count++;
                  if (t > d.tsMax) { d.tsMax = t; d.lastId = msgId; d.lastContent = content; }
                }
              }
            }
          } catch { issues.push(`Bad messages.csv in DM channel ${ck}`); }
        }

        channelMsgs.sort((a, b) => b.ts - a.ts);
        const recentChannelMsgs = channelMsgs.length > 0
          ? channelMsgs.slice(0, MAX_RECENT) : undefined;

        // Sync per-user data into userMap
        for (const [rid, d] of perUser) {
          if (d.count === 0) continue;
          let u = userMap.get(rid);
          if (!u) {
            u = { id: rid, name: recipients.find(r => r.id === rid)?.name ?? rid, myLastMsg: null, myMsgCount: 0, lastMsgId: null, lastChannelId: null, lastMsgContent: null };
            userMap.set(rid, u);
          }
          u.myMsgCount += d.count;
          if (d.tsMax > (u.myLastMsg ?? 0)) {
            u.myLastMsg = d.tsMax;
            u.lastMsgId = d.lastId || u.lastMsgId;
            u.lastChannelId = chanId || u.lastChannelId;
            u.lastMsgContent = d.lastContent || u.lastMsgContent;
            if (recentChannelMsgs) u.recentMsgs = recentChannelMsgs;
          }
        }
      } else {
        channelsSkippedNoGuild++;
      }
      continue;
    }
    channelsWithGuild++;

    const gid = String(chan.guild.id);
    let g = guildMap.get(gid);
    if (!g) {
      g = {
        id: gid,
        name: chan.guild.name || `Server ${gid}`,
        myLastMsg: null,
        myFirstMsg: null,
        myMsgCount: 0,
        channelCount: 0,
      };
      guildMap.set(gid, g);
    } else if (!g.name || g.name.startsWith('Server ')) {
      if (chan.guild.name) g.name = chan.guild.name;
    }
    g.channelCount++;

    const msgsJson = zip.file(`${msgPrefix}${ck}/messages.json`);
    const msgsCsv = zip.file(`${msgPrefix}${ck}/messages.csv`);

    const timestamps: string[] = [];
    if (msgsJson) {
      try {
        const arr = JSON.parse(await msgsJson.async('text')) as Array<Record<string, string>>;
        if (Array.isArray(arr)) {
          for (const msg of arr) {
            const t = msg['Timestamp'] || msg['timestamp'] || msg['created_at'];
            if (t) timestamps.push(t);
          }
        }
      } catch {
        issues.push(`Bad messages.json in ${ck}`);
      }
    } else if (msgsCsv) {
      try {
        const text = await msgsCsv.async('text');
        const lines = text.split(/\r?\n/);
        for (let j = 1; j < lines.length; j++) {
          const line = lines[j];
          if (!line.trim()) continue;
          const cols = parseCsvRow(line);
          if (cols.length >= 2 && cols[1]) timestamps.push(cols[1]);
        }
      } catch {
        issues.push(`Bad messages.csv in ${ck}`);
      }
    }

    g.myMsgCount += timestamps.length;
    for (const ts of timestamps) {
      const t = new Date(ts).getTime();
      if (isNaN(t)) continue;
      if (g.myLastMsg === null || t > g.myLastMsg) g.myLastMsg = t;
      if (g.myFirstMsg === null || t < g.myFirstMsg) g.myFirstMsg = t;
    }
  }


  return {
    servers: Array.from(guildMap.values()),
    users: Array.from(userMap.values()),
    issues,
    importedAt: Date.now(),
  };
}
