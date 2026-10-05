// 로그인 잠금 규칙. 틀린 정보는 다른 방 ID가 되어 방 단위로는 셀 수 없으므로 IP 단위로 센다.
// docs/design.md §4

export interface LockState {
  /** 현재 창 안의 실패 횟수 */
  fails: number;
  /** 현재 창 시작 (ms) */
  windowStart: number;
  /** 이 시각(ms)까지 잠김. 0이면 잠긴 적 없음 */
  lockedUntil: number;
  /** 연속 잠금 횟수. 잠금 시간이 이만큼 두 배로 늘어난다 */
  strikes: number;
}

export const EMPTY_LOCK: LockState = { fails: 0, windowStart: 0, lockedUntil: 0, strikes: 0 };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const WINDOW_MS = 10 * MINUTE;
export const MAX_FAILS = 5;
export const BASE_LOCK_MS = 15 * MINUTE;
export const MAX_LOCK_MS = 24 * HOUR;
/** 이만큼 조용하면 연속 잠금 횟수를 잊는다 */
export const STRIKE_RESET_MS = 24 * HOUR;

/** 남은 잠금 시간(ms). 잠기지 않았으면 0. */
export function lockedFor(state: LockState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}

export function recordFailure(state: LockState, now: number): LockState {
  let { fails, windowStart, strikes } = state;
  if (now - Math.max(windowStart, state.lockedUntil) > STRIKE_RESET_MS) strikes = 0;
  if (now - windowStart > WINDOW_MS) {
    fails = 0;
    windowStart = now;
  }
  fails += 1;
  if (fails < MAX_FAILS) return { fails, windowStart, strikes, lockedUntil: state.lockedUntil };

  strikes += 1;
  const lockMs = Math.min(BASE_LOCK_MS * 2 ** (strikes - 1), MAX_LOCK_MS);
  return { fails: 0, windowStart: now, strikes, lockedUntil: now + lockMs };
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const zeros = ip.includes('::') ? Array(8 - headParts.length - tailParts.length).fill('0') : [];
  return [...headParts, ...zeros, ...tailParts].map((p) => p.toLowerCase().replace(/^0+(?=.)/, ''));
}

/**
 * 같은 사람으로 볼 IP 묶음. IPv6는 보통 한 가입자에게 /64 전체가 주어지므로 앞 64비트만 쓴다.
 * IPv4가 섞인 IPv6(::ffff:1.2.3.4)는 IPv4로 본다.
 */
export function ipBucket(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed.includes(':')) return trimmed || 'unknown';
  if (trimmed.includes('.')) return trimmed.slice(trimmed.lastIndexOf(':') + 1);
  return `${expandIpv6(trimmed).slice(0, 4).join(':')}::/64`;
}
