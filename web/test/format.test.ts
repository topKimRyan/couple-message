import { describe, expect, it } from 'vitest';
import { formatDate, preview, relativeTime } from '../src/format';

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

describe('preview', () => {
  it('짧은 편지는 접지 않는다', () => {
    expect(preview('잘 지내?')).toBeNull();
    expect(preview('첫 줄\n둘째 줄')).toBeNull();
  });

  it('줄이 많으면 앞의 두 줄만', () => {
    expect(preview('하나\n둘\n셋')).toBe('하나\n둘…');
  });

  it('글자가 많으면 앞부분만', () => {
    expect(preview('가'.repeat(100))).toBe(`${'가'.repeat(60)}…`);
  });
});
