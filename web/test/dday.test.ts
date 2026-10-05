import { describe, expect, it } from 'vitest';
import { daysTogether, daysUntil } from '../src/dday';

describe('dday', () => {
  it('사귄 날 당일이 1일', () => {
    expect(daysTogether('2026-10-05', new Date(2026, 9, 5, 23, 59))).toBe(1);
    expect(daysTogether('2025-10-05', new Date(2026, 9, 5))).toBe(366);
  });

  it('남은 날수', () => {
    expect(daysUntil('2027-02-10', new Date(2027, 1, 10))).toBe(0);
    expect(daysUntil('2027-02-10', new Date(2027, 1, 1))).toBe(9);
    expect(daysUntil('2027-02-10', new Date(2027, 1, 11))).toBe(-1);
  });
});
