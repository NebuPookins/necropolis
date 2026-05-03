import JSZip from 'jszip';
import type { Server, ParseResult, ProgressInfo } from './types';

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
  console.log(`[necropolis] detected dirs: messages="${messagesDir}", servers="${serversDir}"`);

  if (!messagesDir) {
    return { servers: [], issues: ['No Messages/ directory found in the zip'], importedAt: Date.now() };
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

    let chan: { guild?: { id: string; name?: string } };
    try {
      chan = JSON.parse(await chanFile.async('text')) as typeof chan;
    } catch {
      issues.push(`Bad channel.json in ${ck}`);
      continue;
    }

    if (!chan.guild) { channelsSkippedNoGuild++; continue; }
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
    issues,
    importedAt: Date.now(),
  };
}
