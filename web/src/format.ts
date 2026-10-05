const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "방금", "5분 전", "3시간 전", "2일 전", 30일 넘으면 날짜. */
export function relativeTime(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return '방금';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}일 전`;
  return formatDate(date);
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

export function formatDateTime(date: Date, now = new Date()): string {
  const time = date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = sameYear ? `${date.getMonth() + 1}월 ${date.getDate()}일` : formatDate(date);
  return `${day} ${time}`;
}
