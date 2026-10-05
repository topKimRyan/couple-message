// 운영자 화면의 계산. 화면과 Firebase 없이 시험할 수 있게 따로 둔다.

/** 헷갈리는 글자(I, O, 0, 1)를 뺀 32자. firestore.rules 의 ^[A-HJ-NP-Z2-9]{10}$ 와 같아야 한다. */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 10;

/** 50비트 무작위 초대 코드. 256 이 32 의 배수라 % 로 줄여도 치우치지 않는다. */
export function generateInviteCode(randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(randomBytes(INVITE_LENGTH), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}

/** 읽기 쉽게 ABCDE-23456. 입력할 때 하이픈은 Worker가 무시한다. */
export function formatInviteCode(code: string): string {
  return code.length === INVITE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

export interface RoomRow {
  roomId: string;
  alias: string | null;
  createdAt: Date;
  lastLetterAt: Date | null;
}

const DAY = 86_400_000;

/** 마지막 편지(없으면 방을 만든 날) 이후 지난 날수. */
export function quietDays(room: RoomRow, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - (room.lastLetterAt ?? room.createdAt).getTime()) / DAY));
}

/** 오래 연락이 없는 방이 위로. */
export function sortByQuiet(rooms: RoomRow[], now = new Date()): RoomRow[] {
  return [...rooms].sort(
    (a, b) => quietDays(b, now) - quietDays(a, now) || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}
