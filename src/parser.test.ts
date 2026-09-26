import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseCsvRows, parseDiscordExport } from './parser';

/** Build an in-memory export zip from path → contents and parse it. */
async function parseZip(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return parseDiscordExport(buf as unknown as File);
}

describe('parseCsvRows', () => {
  it('keeps a quoted multiline message in one record', () => {
    const rows = parseCsvRows(
      'ID,Timestamp,Contents\r\n1,2024-01-01T00:00:00.000Z,"first line\r\nsecond line"\r\n2,2024-01-02T00:00:00.000Z,done\r\n',
    );

    expect(rows).toEqual([
      ['ID', 'Timestamp', 'Contents'],
      ['1', '2024-01-01T00:00:00.000Z', 'first line\r\nsecond line'],
      ['2', '2024-01-02T00:00:00.000Z', 'done'],
    ]);
  });

  it('unescapes quoted double quotes', () => {
    expect(parseCsvRows('Contents\n"say ""hello"""')).toEqual([
      ['Contents'],
      ['say "hello"'],
    ]);
  });
});

describe('parseDiscordExport', () => {
  it('keeps unquoted large snowflake guild IDs intact instead of losing precision', async () => {
    // Discord snowflakes exceed Number.MAX_SAFE_INTEGER, so if channel.json ships
    // them as raw (unquoted) JSON numbers, a naive JSON.parse would round them.
    const guildId = '123456789012345678';
    const channelJson = `{"id":987654321098765432,"type":0,"name":"general","guild":{"id":${guildId},"name":"Test Guild"}}`;

    const zip = new JSZip();
    zip.file('messages/index.json', '{}');
    zip.file(`messages/c1/channel.json`, channelJson);
    zip.file(`messages/c1/messages.csv`, 'ID,Timestamp,Contents\n1,2024-01-01T00:00:00.000Z,hi\n');

    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await parseDiscordExport(buf as unknown as File);

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].id).toBe(guildId);
  });
});

describe('parseDiscordExport DM recipients', () => {
  async function exportWithDm(userJson?: string, type = '"DM"') {
    const zip = new JSZip();
    zip.file('messages/c1/channel.json', `{"id":"c1","type":${type},"recipients":["111111111111111111","222222222222222222"]}`);
    zip.file('messages/c1/messages.csv', 'ID,Timestamp,Contents\n1,2024-01-01T00:00:00.000Z,hi\n');
    if (userJson) zip.file('account/user.json', userJson);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return parseDiscordExport(buf as unknown as File);
  }

  it('excludes the exporting account from the DM user list', async () => {
    const result = await exportWithDm('{"id":111111111111111111,"username":"me"}');

    expect(result.users.map(u => u.id)).toEqual(['222222222222222222']);
  });

  it('keeps all recipients when the account file is missing', async () => {
    const result = await exportWithDm();

    expect(result.users.map(u => u.id).sort()).toEqual(['111111111111111111', '222222222222222222']);
  });

  it.each(['1', '3'])('recognizes legacy numeric DM channel type %s', async (type) => {
    const result = await exportWithDm('{"id":111111111111111111,"username":"me"}', type);

    expect(result.users.map(u => u.id)).toEqual(['222222222222222222']);
  });
});

describe('parseDiscordExport message timestamps', () => {
  const exportWithGuildCsv = (csv: string) => parseZip({
    'messages/c1/channel.json': '{"id":"1","type":0,"guild":{"id":"42","name":"G"}}',
    'messages/c1/messages.csv': csv,
  });

  it('locates the server timestamp column from the CSV header', async () => {
    const result = await exportWithGuildCsv(
      'Timestamp,ID,Contents\n2024-01-01T00:00:00.000Z,1,a\n2024-03-01T00:00:00.000Z,2,b\n',
    );

    expect(result.servers[0].myFirstMsg).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
    expect(result.servers[0].myLastMsg).toBe(Date.parse('2024-03-01T00:00:00.000Z'));
  });

  it('does not count server messages whose timestamp cannot be parsed', async () => {
    const result = await exportWithGuildCsv(
      'ID,Timestamp,Contents\n1,2024-01-01T00:00:00.000Z,a\n2,not a date,b\n',
    );

    expect(result.servers[0].myMsgCount).toBe(1);
  });

  it('reports the newest DM message and recent previews newest first', async () => {
    const { users: [user] } = await parseZip({
      'messages/c9/channel.json': '{"id":"9","type":"DM","recipients":["222222222222222222"]}',
      'messages/c9/messages.json': JSON.stringify([
        { ID: '1', Timestamp: '2024-01-01T00:00:00.000Z', Contents: 'old' },
        { ID: '2', Timestamp: '2024-02-01T00:00:00.000Z', Contents: 'new' },
      ]),
    });

    expect(user.myMsgCount).toBe(2);
    expect(user.lastMsgId).toBe('2');
    expect(user.lastMsgContent).toBe('new');
    expect(user.recentMsgs?.map(m => m.content)).toEqual(['new', 'old']);
  });
});
