// 배포 설정 진단: GET /api/health
// 비밀값 자체는 절대 내보내지 않고, 어느 단계에서 막혔는지와 Google 이 돌려준 오류 문구만 보여 준다.
import type { ServiceAccount } from './google-auth';

export type ConfigResult = { sa: ServiceAccount } | { problem: string };

/** FIREBASE_SERVICE_ACCOUNT 비밀값을 읽는다. 문제가 있으면 무엇이 문제인지 사람이 읽을 문장으로. */
export function parseServiceAccount(raw: string | undefined): ConfigResult {
  if (!raw || !raw.trim()) {
    return { problem: 'Cloudflare 비밀값 FIREBASE_SERVICE_ACCOUNT 가 없어요. Worker → 설정 → 변수 및 비밀에서 비밀(Secret)로 추가해 주세요.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problem: 'FIREBASE_SERVICE_ACCOUNT 가 JSON 형식이 아니에요. 다운로드한 키 파일 내용을 { 부터 } 까지 통째로 다시 붙여 넣어 주세요.' };
  }
  const sa = parsed as Partial<ServiceAccount>;
  const missing = (['project_id', 'client_email', 'private_key'] as const).filter((k) => typeof sa[k] !== 'string' || !sa[k]);
  if (missing.length) {
    return { problem: `FIREBASE_SERVICE_ACCOUNT 에 ${missing.join(', ')} 항목이 없어요. Firebase 콘솔 → 서비스 계정 → 새 비공개 키로 받은 파일인지 확인해 주세요.` };
  }
  if (!sa.private_key!.includes('BEGIN PRIVATE KEY')) {
    return { problem: 'private_key 형식이 이상해요. 키 파일 내용을 고치지 말고 그대로 붙여 넣어 주세요.' };
  }
  return { sa: sa as ServiceAccount };
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

const short = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 400);

/** 순서대로 확인하고 처음 실패한 곳에서 멈춘다. */
export async function runHealthChecks(steps: { name: string; run: () => Promise<string | void> }[]): Promise<HealthCheck[]> {
  const results: HealthCheck[] = [];
  for (const step of steps) {
    try {
      const detail = await step.run();
      results.push({ name: step.name, ok: true, ...(detail ? { detail } : {}) });
    } catch (err) {
      results.push({ name: step.name, ok: false, detail: short(err) });
      break;
    }
  }
  return results;
}

export function healthResponse(checks: HealthCheck[], problem?: string): Response {
  const ok = !problem && checks.every((c) => c.ok);
  return new Response(JSON.stringify({ ok, ...(problem ? { problem } : {}), checks }, null, 2), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
