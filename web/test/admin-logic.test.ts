import { describe, expect, it } from 'vitest';
import { formatInviteCode, generateInviteCode, INVITE_ALPHABET, quietDays, sortByQuiet, type RoomRow } from '../src/admin/logic';

describe('초대 코드', () => {
  it('보안 규칙과 같은 형식', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(new Set(INVITE_ALPHABET).size).toBe(32);
  });

  it('바이트를 글자에 고르게 대응', () => {
    expect(generateInviteCode(() => new Uint8Array([0, 31, 32, 255, 1, 2, 3, 4, 5, 6]))).toBe('A9A9BCDEFG');
  });

  it('보기 좋게 나눈다', () => {
    expect(formatInviteCode('ABCDE23456')).toBe('ABCDE-23456');
    expect(formatInviteCode('KIMLEE2026')).toBe('KIMLE-E2026');
    expect(formatInviteCode('DEVINVITE')).toBe('DEVINVITE');
  });
});

describe('방 현황', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const day = (d: string) => new Date(`${d}T12:00:00Z`);
  const room = (id: string, created: string, last: string | null): RoomRow => ({
    roomId: id,
    alias: id,
    createdAt: day(created),
    lastLetterAt: last ? day(last) : null,
  });

  it('마지막 편지, 없으면 만든 날부터', () => {
    expect(quietDays(room('x', '2026-09-01', '2026-10-02'), now)).toBe(3);
    expect(quietDays(room('x', '2026-09-25', null), now)).toBe(10);
  });

  it('오래 조용한 방이 위로', () => {
    const rows = [room('busy', '2026-01-01', '2026-10-05'), room('quiet', '2026-01-01', '2026-03-01'), room('new', '2026-10-01', null)];
    expect(sortByQuiet(rows, now).map((r) => r.roomId)).toEqual(['quiet', 'new', 'busy']);
  });
});
