import JSZip from 'jszip';
import type { DiscordUser, Server, ParseResult, ProgressInfo } from './types';

/** Parse CSV records, including newlines inside quoted fields. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      }
      else cur += c;
    }
  }
  if (cur || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/**
 * Quote numeric ID fields before JSON.parse to avoid precision loss on large
 * Discord snowflakes (> Number.MAX_SAFE_INTEGER).
 */
function quoteSnowflakeIds(raw: string): string {
  return raw.replace(/"id":\s*(\d{17,})/gi, '"id":"$1"');
}

/**
 * Whether a channel.json `type` denotes a DM or group DM. Newer exports use
 * string names; older ones use Discord's numeric channel types (1 = DM,
 * 3 = GROUP_DM).
 */
function isDmChannelType(type: unknown): boolean {
  return type === 'DM' || type === 'GROUP_DM' || type === 1 || type === 3;
}

/** A single message read from a channel's messages.json or messages.csv. */
interface ChannelMessage {
  readonly id: string;
  readonly ts: number;
  readonly content: string;
}

type ChannelMessagesResult =
  | { readonly ok: true; readonly messages: readonly ChannelMessage[] }
  | { readonly ok: false; readonly file: string };

/** Parse a message timestamp to epoch ms, or null if missing/unparseable. */
function parseTimestamp(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const t = new Date(String(raw)).getTime();
  return isNaN(t) ? null : t;
}

function messagesFromJson(raw: string): ChannelMessage[] {
  const arr: unknown = JSON.parse(quoteSnowflakeIds(raw));
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((msg: Record<string, unknown>) => {
    const ts = parseTimestamp(msg['Timestamp'] ?? msg['timestamp'] ?? msg['created_at']);
    if (ts === null) return [];
    return [{
      id: String(msg['ID'] ?? msg['id'] ?? ''),
      ts,
      content: String(msg['Contents'] ?? msg['Content'] ?? msg['content'] ?? ''),
    }];
  });
}

function messagesFromCsv(text: string): ChannelMessage[] {
  const [header = [], ...rows] = parseCsvRows(text);
  const tsIdx = header.findIndex(h => /timestamp/i.test(h));
  if (tsIdx < 0) return [];
  const idIdx = header.findIndex(h => /^id$/i.test(h));
  const contentIdx = header.findIndex(h => /contents|content|message/i.test(h));
  return rows.flatMap(cols => {
    const ts = parseTimestamp(cols[tsIdx]);
    if (ts === null) return [];
    return [{
      id: cols[idIdx] ?? '',
      ts,
      content: cols[contentIdx] ?? '',
    }];
  });
}

/**
 * Read the messages with a valid timestamp from a channel folder, preferring
 * messages.json over messages.csv. A channel with neither file has no messages.
 */
async function readChannelMessages(zip: JSZip, dir: string): Promise<ChannelMessagesResult> {
  const sources = [
    { file: 'messages.json', parse: messagesFromJson },
    { file: 'messages.csv', parse: messagesFromCsv },
  ] as const;
  for (const { file, parse } of sources) {
    const entry = zip.file(`${dir}/${file}`);
    if (!entry) continue;
    try {
      return { ok: true, messages: parse(await entry.async('text')) };
    } catch {
      return { ok: false, file };
    }
  }
  return { ok: true, messages: [] };
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

/**
 * Read the exporting account's own user ID from Account/user.json. Discord
 * lists the exporter among every DM's recipients, so callers need this to
 * avoid treating the exporter as one of their own contacts.
 */
async function readOwnUserId(zip: JSZip): Promise<string | null> {
  const [userFile] = zip.file(/^account\/user\.json$/i);
  if (!userFile) return null;
  try {
    const data: unknown = JSON.parse(quoteSnowflakeIds(await userFile.async('text')));
    const id = typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
    return id == null || id === '' ? null : String(id);
  } catch {
    return null;
  }
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

  const ownUserId = await readOwnUserId(zip);
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
      const raw = await chanFile.async('text');
      chan = JSON.parse(quoteSnowflakeIds(raw)) as typeof chan;
    } catch {
      issues.push(`Bad channel.json in ${ck}`);
      continue;
    }

    if (!chan.guild) {
      const isDm = isDmChannelType(chan.type);
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
        }).filter(r => r.id && r.id !== ownUserId);

        const chanId = String(chan.id ?? '').replace(/^c/, '');

        const read = await readChannelMessages(zip, `${msgPrefix}${ck}`);
        if (!read.ok) {
          issues.push(`Bad ${read.file} in DM channel ${ck}`);
          continue;
        }

        // This export only has the user's own messages, so every recipient
        // shares the channel's count, latest message, and recent previews.
        const MAX_RECENT = 5;
        const newestFirst = [...read.messages].sort((a, b) => b.ts - a.ts);
        const latest = newestFirst[0];
        if (!latest) continue;
        const recentMsgs = newestFirst.slice(0, MAX_RECENT).map(({ ts, content }) => ({ ts, content }));

        // Sync per-user data into userMap
        for (const r of recipients) {
          let u = userMap.get(r.id);
          if (!u) {
            u = { id: r.id, name: r.name, myLastMsg: null, myMsgCount: 0, lastMsgId: null, lastChannelId: null, lastMsgContent: null };
            userMap.set(r.id, u);
          }
          u.myMsgCount += read.messages.length;
          if (latest.ts > (u.myLastMsg ?? 0)) {
            u.myLastMsg = latest.ts;
            u.lastMsgId = latest.id || u.lastMsgId;
            u.lastChannelId = chanId || u.lastChannelId;
            u.lastMsgContent = latest.content || u.lastMsgContent;
            u.recentMsgs = recentMsgs;
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

    const read = await readChannelMessages(zip, `${msgPrefix}${ck}`);
    if (!read.ok) {
      issues.push(`Bad ${read.file} in ${ck}`);
      continue;
    }
    g.myMsgCount += read.messages.length;
    for (const { ts } of read.messages) {
      if (g.myLastMsg === null || ts > g.myLastMsg) g.myLastMsg = ts;
      if (g.myFirstMsg === null || ts < g.myFirstMsg) g.myFirstMsg = ts;
    }
  }

  return {
    servers: Array.from(guildMap.values()),
    users: Array.from(userMap.values()),
    issues,
    importedAt: Date.now(),
  };
}
