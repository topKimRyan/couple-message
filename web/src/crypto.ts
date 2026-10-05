// 다섯 가지 정보 → 방 ID, 암호화 키, 본인 구분(side).
// 여기 상수나 정규화 규칙을 바꾸면 기존 방에 다시 들어올 수 없게 된다.
// 바꿔야 하면 salt 버전을 올리고 이전 방법을 함께 지원할 것. (docs/design.md §2)

export type Side = 'a' | 'b';

export interface LoginInput {
  myName: string;
  partnerName: string;
  myBirth: string;
  partnerBirth: string;
  anniversary: string;
}

export interface RoomKeys {
  roomId: string;
  side: Side;
  encKey: CryptoKey;
}

export const PBKDF2_ITERATIONS = 600_000;
const ROOM_SALT = 'couple-mailbox/room/v1';
const ENC_SALT = 'couple-mailbox/enc/v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const encoder = new TextEncoder();

export class InputError extends Error {}

export function normalizeName(name: string): string {
  return name.normalize('NFC').replace(/\s+/gu, '').toLowerCase();
}

function checkDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) throw new InputError(`${label}을 선택해 주세요.`);
  return value;
}

/** 순서와 무관한 키 재료와, 입력한 사람이 정렬 후 몇 번째 쌍인지를 돌려준다. */
export function buildMaterial(input: LoginInput): { material: string; side: Side } {
  const myName = normalizeName(input.myName);
  const partnerName = normalizeName(input.partnerName);
  if (!myName) throw new InputError('내 이름을 입력해 주세요.');
  if (!partnerName) throw new InputError('상대 이름을 입력해 주세요.');

  const myPair = `${myName}|${checkDate(input.myBirth, '내 생일')}`;
  const partnerPair = `${partnerName}|${checkDate(input.partnerBirth, '상대 생일')}`;
  const anniversary = checkDate(input.anniversary, '사귄 날');
  if (myPair === partnerPair) throw new InputError('두 사람의 이름과 생일이 같아서 구분할 수 없어요.');

  // localeCompare는 기기·언어 설정마다 결과가 다를 수 있으므로 코드 단위 비교만 쓴다.
  const [p1, p2] = myPair < partnerPair ? [myPair, partnerPair] : [partnerPair, myPair];
  return { material: `${p1}\n${p2}\n${anniversary}`, side: myPair === p1 ? 'a' : 'b' };
}

function pbkdf2Params(salt: string, iterations: number): Pbkdf2Params {
  return { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations };
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveRoomKeys(input: LoginInput, iterations = PBKDF2_ITERATIONS): Promise<RoomKeys> {
  const { material, side } = buildMaterial(input);
  const base = await crypto.subtle.importKey('raw', encoder.encode(material), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const [roomBits, encKey] = await Promise.all([
    crypto.subtle.deriveBits(pbkdf2Params(ROOM_SALT, iterations), base, 256),
    crypto.subtle.deriveKey(pbkdf2Params(ENC_SALT, iterations), base, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
  ]);
  return { roomId: toHex(roomBits), side, encKey };
}

export interface Sealed {
  ct: string;
  iv: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { ct: toBase64(new Uint8Array(ct)), iv: toBase64(iv) };
}

export async function open<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
