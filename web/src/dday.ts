const DAY_MS = 86_400_000;

function utcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function parseDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return utcDay(y, m, d);
}

function localToday(now: Date): number {
  return utcDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 사귄 날을 1일로 세는 한국식 날수. */
export function daysTogether(anniversary: string, now = new Date()): number {
  return localToday(now) - parseDay(anniversary) + 1;
}

/** 목표일까지 남은 날수. 당일은 0, 지나면 음수. */
export function daysUntil(target: string, now = new Date()): number {
  return parseDay(target) - localToday(now);
}
