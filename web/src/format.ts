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

/** 접힌 편지에 보일 앞부분. 줄 수나 글자 수를 넘으면 잘라 "…"을 붙이고, 짧으면 null. */
export function preview(text: string, maxLines = 2, maxChars = 60): string | null {
  const lines = text.split('\n');
  let head = lines.slice(0, maxLines).join('\n');
  if (head.length > maxChars) head = head.slice(0, maxChars);
  if (head === text) return null;
  return `${head.trimEnd()}…`;
}
