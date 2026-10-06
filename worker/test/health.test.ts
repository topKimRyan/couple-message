import { describe, expect, it } from 'vitest';
import { parseServiceAccount, runHealthChecks } from '../src/health';

const KEY = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n';

describe('parseServiceAccount', () => {
  it('없음, JSON 아님, 항목 빠짐, 키 형식을 구분해서 알려 준다', () => {
    expect(parseServiceAccount(undefined)).toEqual({ problem: expect.stringContaining('없어요') });
    expect(parseServiceAccount('  ')).toEqual({ problem: expect.stringContaining('없어요') });
    expect(parseServiceAccount('{"project_id": ')).toEqual({ problem: expect.stringContaining('JSON') });
    expect(parseServiceAccount('{"project_id":"p"}')).toEqual({ problem: expect.stringContaining('client_email, private_key') });
    expect(parseServiceAccount('{"project_id":"p","client_email":"e","private_key":"nope"}')).toEqual({
      problem: expect.stringContaining('private_key'),
    });
  });

  it('정상 키', () => {
    const raw = JSON.stringify({ project_id: 'p', client_email: 'e@x', private_key: KEY, type: 'service_account' });
    expect(parseServiceAccount(raw)).toEqual({ sa: expect.objectContaining({ project_id: 'p' }) });
  });

  it('문제 문구에 비밀값이 섞이지 않는다', () => {
    const result = parseServiceAccount('{"project_id":"p","client_email":"e","private_key":"SECRET-123"}');
    expect(JSON.stringify(result)).not.toContain('SECRET-123');
  });
});

describe('runHealthChecks', () => {
  it('처음 실패한 단계에서 멈추고 이유를 남긴다', async () => {
    const ran: string[] = [];
    const checks = await runHealthChecks([
      { name: 'a', run: async () => void ran.push('a') },
      { name: 'b', run: async () => { ran.push('b'); throw new Error('token exchange failed: 400 invalid_grant'); } },
      { name: 'c', run: async () => void ran.push('c') },
    ]);
    expect(ran).toEqual(['a', 'b']);
    expect(checks).toEqual([
      { name: 'a', ok: true },
      { name: 'b', ok: false, detail: 'token exchange failed: 400 invalid_grant' },
    ]);
  });
});
