import { describe, expect, it } from 'vitest';
import { EMPTY_LOCK, ipBucket, lockedFor, recordFailure, type LockState } from '../src/lockout';

const MIN = 60_000;
const HOUR = 60 * MIN;

function fail(times: number, state: LockState, at: number): LockState {
  for (let i = 0; i < times; i++) state = recordFailure(state, at);
  return state;
}

describe('recordFailure', () => {
  it('10분 안에 5번이면 15분 잠금', () => {
    const s = fail(4, EMPTY_LOCK, 0);
    expect(lockedFor(s, 0)).toBe(0);
    const locked = recordFailure(s, 5 * MIN);
    expect(lockedFor(locked, 5 * MIN)).toBe(15 * MIN);
  });

  it('10분이 지나면 다시 센다', () => {
    let s = fail(4, EMPTY_LOCK, 0);
    s = recordFailure(s, 11 * MIN);
    expect(s.fails).toBe(1);
    expect(lockedFor(s, 11 * MIN)).toBe(0);
  });

  it('잠금이 반복되면 두 배씩, 최대 24시간', () => {
    let s = EMPTY_LOCK;
    let t = 0;
    const lengths: number[] = [];
    for (let i = 0; i < 8; i++) {
      s = fail(5, s, t);
      lengths.push(lockedFor(s, t) / MIN);
      t = s.lockedUntil + 1;
    }
    expect(lengths).toEqual([15, 30, 60, 120, 240, 480, 960, 1440]);
  });

  it('24시간 조용하면 다시 15분부터', () => {
    let s = fail(5, EMPTY_LOCK, 0);
    s = fail(5, s, s.lockedUntil + 1);
    expect(s.strikes).toBe(2);
    const later = s.lockedUntil + 25 * HOUR;
    s = fail(5, s, later);
    expect(lockedFor(s, later)).toBe(15 * MIN);
  });
});

describe('ipBucket', () => {
  it('IPv4 그대로, IPv6 /64, 섞인 주소는 IPv4', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:0DB8:0001:0002:ffff:0:0:9')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
    expect(ipBucket('::ffff:198.51.100.1')).toBe('198.51.100.1');
    expect(ipBucket('')).toBe('unknown');
  });
});
