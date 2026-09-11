import { describe, expect, it } from 'vitest';
import { parseCsvRows } from './parser';

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
