import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseCsvRows, parseDiscordExport } from './parser';

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
