// Firestore REST API 최소 클라이언트. https://firebase.google.com/docs/firestore/reference/rest

export type FieldValue = string | number | boolean | null | Date | { [key: string]: FieldValue };

type Value =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, Value> } };

export function encodeValue(v: FieldValue): Value {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(obj: Record<string, FieldValue>): Record<string, Value> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encodeValue(v)]));
}

export function decodeValue(v: Value): FieldValue {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  return decodeFields(v.mapValue.fields ?? {});
}

export function decodeFields(fields: Record<string, Value>): Record<string, FieldValue> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

export interface Doc {
  fields: Record<string, FieldValue>;
  updateTime: string;
}

export type Precondition = { exists: boolean } | { updateTime: string };

export interface Write {
  path: string;
  fields: Record<string, FieldValue>;
  /** 지정하면 이 필드만 바꾸고 나머지는 둔다. 없으면 문서 전체를 덮어쓴다. */
  mask?: string[];
  precondition?: Precondition;
}

/** commit의 전제 조건이 맞지 않아 아무것도 쓰이지 않았다. */
export class PreconditionFailed extends Error {}

export class Firestore {
  private readonly root: string;

  constructor(
    projectId: string,
    private readonly accessToken: () => Promise<string>,
    private readonly fetchFn: typeof fetch = fetch,
    /** 에뮬레이터 시험용으로만 바꾼다. */
    private readonly baseUrl = 'https://firestore.googleapis.com',
  ) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchFn(url, {
      ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
    });
  }

  async get(path: string): Promise<Doc | null> {
    const res = await this.request(`${this.baseUrl}/v1/${this.root}/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore get ${path}: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { fields?: Record<string, Value>; updateTime: string };
    return { fields: decodeFields(data.fields ?? {}), updateTime: data.updateTime };
  }

  /** 모든 쓰기를 한꺼번에 적용하거나 하나도 적용하지 않는다. */
  async commit(writes: Write[]): Promise<void> {
    const body = {
      writes: writes.map((w) => ({
        update: { name: `${this.root}/${w.path}`, fields: encodeFields(w.fields) },
        ...(w.mask && { updateMask: { fieldPaths: w.mask } }),
        ...(w.precondition && { currentDocument: w.precondition }),
      })),
    };
    const res = await this.request(`${this.baseUrl}/v1/${this.root}:commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const text = await res.text();
    if (/FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(text)) throw new PreconditionFailed(text);
    throw new Error(`firestore commit: ${res.status} ${text}`);
  }
}
