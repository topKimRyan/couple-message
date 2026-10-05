import { describe, expect, it } from 'vitest';
import { formatDate, relativeTime } from '../src/format';

describe('relativeTime', () => {
  const now = new Date(2026, 9, 5, 12, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('구간별 표시', () => {
    expect(relativeTime(ago(30_000), now)).toBe('방금');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5분 전');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3시간 전');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2일 전');
    expect(relativeTime(new Date(2026, 0, 2), now)).toBe(formatDate(new Date(2026, 0, 2)));
  });

  it('기기 시계가 약간 빨라도 방금', () => {
    expect(relativeTime(new Date(now.getTime() + 5_000), now)).toBe('방금');
  });
});
