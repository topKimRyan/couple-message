import { describe, expect, it } from 'vitest';
import { buildMaterial, deriveRoomKeys, InputError, normalizeName, open, seal, type LoginInput } from '../src/crypto';

const minsu: LoginInput = {
  myName: '김민수',
  partnerName: '이지은',
  myBirth: '2010-03-14',
  partnerBirth: '2010-11-02',
  anniversary: '2025-05-01',
};

const jieun: LoginInput = {
  myName: ' 이 지은 ',
  partnerName: '김민수',
  myBirth: '2010-11-02',
  partnerBirth: '2010-03-14',
  anniversary: '2025-05-01',
};

describe('normalizeName', () => {
  it('공백 제거, 영문 소문자, NFC', () => {
    expect(normalizeName(' Kim  Min\tSu ')).toBe('kimminsu');
    expect(normalizeName('김')).toBe('김'); // 조합형(NFD) 한글
  });
});

describe('buildMaterial', () => {
  it('누가 입력해도 같은 재료, 반대 side', () => {
    const a = buildMaterial(minsu);
    const b = buildMaterial(jieun);
    expect(a.material).toBe(b.material);
    expect(a.side).not.toBe(b.side);
  });

  it('잘못된 입력은 InputError', () => {
    expect(() => buildMaterial({ ...minsu, myName: '  ' })).toThrow(InputError);
    expect(() => buildMaterial({ ...minsu, anniversary: '' })).toThrow(InputError);
    expect(() => buildMaterial({ ...minsu, partnerName: '김민수', partnerBirth: '2010-03-14' })).toThrow(InputError);
  });
});

describe('deriveRoomKeys', () => {
  it('고정 벡터: 이 값이 바뀌면 기존 방에 못 들어온다', async () => {
    const keys = await deriveRoomKeys(minsu);
    expect(keys.roomId).toBe('d6decb9be2cea8e6f51bb5220be73ce9628bbfa88ad409cbee939464d5be6af6');
    expect(keys.side).toBe('a');
  });

  it('두 사람이 같은 방, 같은 키', async () => {
    const [a, b] = await Promise.all([deriveRoomKeys(minsu, 1000), deriveRoomKeys(jieun, 1000)]);
    expect(a.roomId).toBe(b.roomId);
    expect(a.roomId).toMatch(/^[0-9a-f]{64}$/);
    const sealed = await seal(a.encKey, { text: '잘 지내?' });
    expect(await open(b.encKey, sealed)).toEqual({ text: '잘 지내?' });
  });

  it('사귄 날이 다르면 다른 방', async () => {
    const [a, b] = await Promise.all([
      deriveRoomKeys(minsu, 1000),
      deriveRoomKeys({ ...minsu, anniversary: '2025-05-02' }, 1000),
    ]);
    expect(a.roomId).not.toBe(b.roomId);
  });
});
