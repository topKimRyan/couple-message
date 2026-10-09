# 커플 우체통 설계 문서

기획서: [spec.md](spec.md) · 작성일 2026-10-05

이 문서는 기획서를 구현 가능한 수준으로 구체화한다. 이 문서만 보고 1~4단계를 구현할 수 있는 것을 목표로 한다.

## 확정된 기술 선택

| 항목 | 선택 | 이유 |
| --- | --- | --- |
| DB·로그인·푸시 | Firebase Spark(무료) — Firestore, Auth, Cloud Messaging | 무료, 결제 수단 불필요 |
| 호스팅 | Cloudflare Worker 정적 파일(Workers Static Assets) | Worker 하나가 화면과 API를 같은 주소에서 서빙. GitHub 연결로 자동 배포. 주소 `couple-message.2369-ryan.workers.dev`는 만료되지 않음 |
| 서버 코드(잠금·알림) | **Cloudflare Workers Free** | Cloud Functions는 Blaze 요금제(카드 등록)가 필요. Workers는 카드 없이 무료 |
| 프론트엔드 | **Vite + Vanilla TypeScript** | 의존성 최소화. 3년 방치해도 빌드·실행이 깨질 여지가 적음 |
| 암호 | 브라우저 Web Crypto(PBKDF2-SHA256, AES-GCM) | 외부 암호 라이브러리 불필요, 모든 최신 브라우저 지원 |

## 1. 아키텍처

```
[커플 기기 PWA]
  │ 다섯 가지 정보 → (기기 안에서) roomId, encKey, side 계산
  │
  │ (1) POST /login {roomId, side, deviceId}
  ▼
[Cloudflare Worker] ── IP 잠금 확인 ── Firestore REST(서비스 계정)로 방 존재 확인
  │ (2) Firebase custom token (claims: roomId, side)
  ▼
[커플 기기] (3) signInWithCustomToken → Firestore 직접 읽기·쓰기 (암호문만 오감)
  │ (4) 편지 작성 후 POST /notify
  ▼
[Worker] ── FCM HTTP v1 ──▶ 상대 기기 (웹 푸시)

[운영자 브라우저] ── Google 로그인 ──▶ Firestore(invites, rooms 메타데이터)
```

핵심 판단:

- **잠금이 의미 있으려면 방 존재 확인이 반드시 Worker를 거쳐야 한다.** 클라이언트가 Firestore에서 `rooms/{roomId}`를 바로 읽을 수 있으면 공격자는 Worker를 우회해 무제한으로 대입할 수 있다. 그래서 커플은 Worker가 발급한 custom token 없이는 Firestore에 아무것도 읽을 수 없게 한다. (기획서의 "방 ID를 아는 사람이 읽는다"보다 엄격한 방식)
- 이름·생일 원본은 기기 밖으로 나가지 않는다. Worker도 해시된 `roomId`만 받는다.
- Worker는 Firebase 서비스 계정 키(Worker Secret)로 다음을 직접 한다. 라이브러리 없이 Web Crypto로 RS256 JWT 서명.
  - Firebase custom token 발급
  - Google OAuth 액세스 토큰 발급 → Firestore REST, FCM HTTP v1 호출
  - Firebase ID 토큰 검증(Google 공개키 JWKS, 캐시)
- 커플의 Firebase Auth uid는 `r_{roomId 앞 32자}_{side}`로 고정한다. 매 로그인마다 사용자가 새로 쌓이지 않는다.

## 2. 키 파생

### 정규화

| 입력 | 처리 |
| --- | --- |
| 이름 | `NFC` 정규화 → 모든 공백 문자 제거 → 영문 소문자화 |
| 날짜 | 달력 입력값 그대로 `YYYY-MM-DD` |

### 계산

```
myPair      = normalize(내 이름) + "|" + 내 생일
partnerPair = normalize(상대 이름) + "|" + 상대 생일
[p1, p2]    = 두 쌍을 사전순 정렬
material    = p1 + "\n" + p2 + "\n" + 사귄 날

roomId = hex( PBKDF2-SHA256(material, salt="couple-mailbox/room/v1", 600000회, 256bit) )
encKey = PBKDF2-SHA256(material, salt="couple-mailbox/enc/v1", 600000회) → AES-GCM-256 키
side   = (myPair == p1) ? "a" : "b"
```

- `myPair == partnerPair`이면 방 생성 거부(구분 불가).
- salt에 버전(`v1`)을 넣어 두어, 나중에 알고리즘을 바꾸면 v2 방으로 이전할 수 있다.
- PBKDF2 60만 회는 휴대폰에서 1초 안팎. 두 키를 병렬로 계산하고 로딩 표시를 띄운다.
- 암호화: 문서마다 12바이트 랜덤 IV, 저장 형식 `{ct: base64, iv: base64}`. 평문은 JSON.
- 암호문이 놓이는 자리(`contacts/a`, `settings`, `letters/{편지 ID}/{보낸 쪽}`)를 AES-GCM 추가 인증 데이터로 묶는다. 서버에서 암호문을 다른 칸으로 옮기거나 보낸 쪽을 바꾸면 복호화가 실패한다.
- 평문 형식: 연락처 `{text}`(500자), 편지 `{text}`(1000자), 방 설정 `{graduation: "YYYY-MM-DD" | null}`.
- 로그인 후 `encKey`는 추출 불가(non-extractable) `CryptoKey`로 IndexedDB에 보관해 재방문 시 재입력이 필요 없게 한다. "이 기기에서 나가기"로 삭제한다.
- 단위 테스트: 두 사람이 각자 입력한 경우 같은 roomId·반대 side가 나오는지, 공백·대소문자·한글 조합형 차이를 흡수하는지 고정 벡터로 검증한다.

## 3. Firestore 데이터 모델과 보안 규칙

| 경로 | 필드 | 접근 |
| --- | --- | --- |
| `invites/{code}` | alias, used, createdAt, usedAt, roomId, roomDeletedAt | 운영자: 읽기, 만들기(코드 형식·필드 검사), 별칭 고치기, 안 쓴 코드 지우기. 사용 처리는 Worker |
| `config/admins` | emails (소문자 이메일 배열) | 아무도 못 씀(콘솔에서만). 규칙과 Worker가 운영자 판별에 사용 |
| `rooms/{roomId}` | createdAt, inviteCode, lastLetterAt, knownDevices(수), contacts.a / contacts.b `{ct, iv, updatedAt}`, settings `{ct, iv}` | 해당 방 토큰: 읽기, 자기 side 연락처·settings 수정. 운영자: 메타 읽기·삭제 |
| `rooms/{roomId}/letters/{id}` | from(a/b), ct, iv, sentAt, readAt, editedAt(고친 경우) | 해당 방 토큰. 생성 시 `from == token.side`, `sentAt == request.time`. `readAt`은 받는 쪽만 한 번 설정. 보낸 쪽만 `ct`·`iv`·`editedAt` 수정 가능(`editedAt == request.time`). 삭제 불가 |
| `rooms/{roomId}/devices/{deviceId}` | side, fcmToken, firstSeen, lastSeen | 클라이언트 전면 차단 (Worker만) |
| `lockouts/{key}` | fails, windowStart, lockedUntil, strikes | 클라이언트 전면 차단 (Worker만) |

규칙 요점(`firestore.rules`):

```
function isAdmin() { return request.auth != null
  && request.auth.token.email_verified == true
  && request.auth.token.email.lower() in get(/databases/$(database)/documents/config/admins).data.emails; }
function inRoom(roomId) { return request.auth != null && request.auth.token.roomId == roomId; }
```

- `rooms` 컬렉션 `list`는 운영자만 허용 → 다른 방의 존재 여부가 드러나지 않는다.
- 운영자는 `rooms/{id}` 메타와 `invites`만 본다. 연락처·편지는 암호문이라 내용을 볼 수 없다.
- `lastLetterAt`은 편지를 쓴 클라이언트가 같은 batch에서 갱신한다. 규칙이 `getAfter`로 이를 강제하므로 운영자 화면의 "마지막 편지"가 정확하다.
- 기기에는 Firestore 오프라인 캐시(IndexedDB)를 켜서 다시 열 때 읽기 횟수를 아낀다. 캐시에는 암호문만 있고, "이 기기에서 나가기"로 함께 지운다.
- 편지는 최근 50통씩 불러오고 "이전 편지 더 보기"로 늘린다.
- 방 삭제: 하위 컬렉션이 자동 삭제되지 않으므로 Worker `POST /admin/delete-room`이 letters·devices를 지운 뒤 방 문서를 지운다.

## 4. Worker 엔드포인트

| 엔드포인트 | 입력 | 동작 |
| --- | --- | --- |
| `POST /create` | inviteCode, roomId, side, deviceId | 잠금 확인 → 초대 존재·미사용 확인 → 방이 이미 있으면 `409 이미 있는 방`(초대 소모 안 함) → 트랜잭션으로 방 생성 + 초대 사용 처리 + 기기 등록 → custom token |
| `POST /login` | roomId, side, deviceId | 잠금 확인 → 방 없으면 실패 카운트 + `401` → 있으면 custom token. 처음 보는 deviceId면 기기 등록 후 이 기기를 뺀 방의 모든 기기(상대 + 내 다른 기기)에 "새 기기에서 들어왔어요" 푸시 |
| `POST /register-push` | ID 토큰, deviceId, fcmToken | 해당 방 devices 문서에 토큰 저장. 같은 토큰이 다른 deviceId 에 있으면 떼어 알림이 두 번 가지 않게 한다 |
| `POST /notify` | ID 토큰, type(letter / contacts) | 상대 side 기기들에 FCM 전송. 본문은 "새 편지가 왔어요"처럼 내용 없이. 만료 토큰(UNREGISTERED)은 삭제 |
| `POST /admin/delete-room` | 운영자 ID 토큰, roomId | 구글 로그인 이메일이 `config/admins`에 있는지 확인 → 편지·기기 삭제 → 방 삭제 → 한 번 더 훑어 그 사이 들어온 편지 삭제 → 초대 코드에 `roomDeletedAt` 기록 |

- 잠금(`worker/src/lockout.ts`): 키는 IP 하나. deviceId는 공격자가 마음대로 바꿀 수 있어 쓰지 않는다.
  - IPv6는 한 가입자가 /64 전체를 쓰므로 앞 64비트로 묶는다. 저장 키는 `sha256(서비스 계정 비밀키 | IP 묶음)`이라 IP 원본은 남지 않는다.
  - 10분 안에 5회 실패 → 15분 잠금, 반복될수록 2배(최대 24시간), 24시간 조용하면 다시 15분부터.
  - 실패로 세는 것: `/login` 정보 불일치, `/create` 형식 오류·초대 코드 무효. 성공은 카운트를 건드리지 않는다.
  - 동시 요청으로 카운트를 우회하지 못하게 `lockouts` 문서를 updateTime 전제 조건으로 쓰고, 3번 충돌하면 거절한다.
- `/register-push`, `/notify`는 `Authorization: Bearer <Firebase ID 토큰>`. Worker가 Google 공개키(JWK)로 서명과 `roomId·side` 클레임을 확인한다.
- 푸시는 데이터 전용 웹 푸시이고, 서비스 워커(`web/public/sw.js`)가 제목·본문만 띄운다. 편지 내용은 푸시에 절대 넣지 않는다.
- 실패 응답은 "정보가 맞지 않아요" 하나로 통일(방 없음과 형식 오류를 구분하지 않음).
- 모든 API는 `/api/*`. 화면과 같은 주소라 CORS가 필요 없다(`wrangler.toml`의 `run_worker_first`).
- Secret: `FIREBASE_SERVICE_ACCOUNT`(JSON) 하나. `wrangler secret put`으로 설정. 운영자 목록은 Firestore `config/admins`.

## 5. 프론트엔드

```
web/
  index.html            커플 화면 (로그인 → 방)
  admin.html            운영자 화면
  public/manifest.webmanifest, icons/, firebase-messaging-sw.js
  src/crypto.ts         정규화, PBKDF2, AES-GCM, 키 보관(IndexedDB)
  src/api.ts            Worker 호출
  src/firebase.ts       Firebase 초기화(modular SDK, 필요한 모듈만)
  src/pages/login.ts    다섯 칸 입력, 방 만들기(초대 코드 칸 펼치기)/입장
  src/pages/room.ts     상단 고정 연락처 칸, D-day, 편지 목록·쓰기, 읽음 표시
  admin.html, src/admin/  운영자 화면: 초대 발급, 방 현황(오래 연락 없는 순), 방 삭제.
                          커플 화면과 다른 이름의 Firebase 앱을 써서 같은 브라우저에서도 로그인이 섞이지 않는다
  src/install-hint.ts   iOS·Android 홈 화면 추가 안내
worker/
  src/index.ts, src/google-auth.ts, src/firestore.ts, src/fcm.ts, src/lockout.ts
  wrangler.toml
firestore.rules, firestore.indexes.json, firebase.json
tests/  crypto 단위 테스트(vitest), 보안 규칙 테스트(Firestore 에뮬레이터)
```

화면 요점:

- **방 화면:** 맨 위에 두 사람의 연락처 칸(수정 시각 "3일 전 수정"), 그 아래 D-day("사귄 지 412일 · 졸업까지 230일"), 편지 목록(시간순, 안 읽은 편지 강조), 하단에 편지 쓰기.
- **D-day:** 사귄 날은 로그인 입력에서 이미 알고 있다. 졸업일은 방 설정(암호화)에서 입력한다.
- **읽음:** 받은 편지가 화면에 보이면 `readAt` 설정.
- **알림 권한:** 첫 입장 후 홈 화면 추가 안내 → 알림 허용 버튼(아이폰은 홈 화면 앱에서만 가능하다고 안내).
- **보안 안내:** 첫 입장 시 "다섯 가지 정보를 모두 아는 사람은 들어올 수 있어요" 고지(기획서 한계 항목).

## 6. 기획서 대응표

| 기획서 항목 | 설계 위치 |
| --- | --- |
| 최신 연락처 칸 | §3 `contacts`, §5 방 화면 |
| 안부 편지·읽음 표시 | §3 `letters`, §5 |
| 새 편지·연락처 변경·새 기기 알림 | §4 `/notify`, `/login` |
| 디데이 | §5 |
| 방 삭제 | §4 `/admin/delete-room` |
| 초대 코드·별칭 | §3 `invites`, §4 `/create` |
| 방 현황(오래 연락 없는 순) | §3 `lastLetterAt`, §5 admin |
| 운영자 구글 로그인 | §3 `isAdmin()` |
| 느린 해시·잠금 | §2, §4 |
| 운영자도 쉽게 못 읽음 | §2 AES-GCM, §3 |

## 7. 무료 한도와 장기 유지

| 서비스 | 무료 한도(개발 전 재확인) | 예상 사용 |
| --- | --- | --- |
| Firestore (Spark) | 하루 읽기 5만, 쓰기 2만, 저장 1GiB | 수십 쌍이면 하루 수천 회 이하 |
| Cloudflare Workers 정적 파일 | 정적 파일 요청은 무료·무제한(Worker 요청 한도에 안 들어감) | 정적 파일 수 MB |
| Firebase Auth (custom token) | 무료 | — |
| FCM | 무료 | — |
| Cloudflare Workers Free | 하루 10만 요청 | 하루 수백 회 |

장기 유지 체크리스트:

- Firebase 프로젝트, Cloudflare 계정 모두 2단계 인증.
- 서비스 계정 키는 만료되지 않지만, 유출 시 교체 절차(새 키 발급 → `wrangler secret put` → 옛 키 삭제)를 README에 남긴다.
- Firebase JS SDK와 빌드 도구는 버전을 고정하고, 배포된 정적 파일은 빌드 없이도 계속 동작하므로 방치에 강하다.
- Worker 호환성 날짜(`compatibility_date`)를 고정해 런타임 변경 영향을 막는다.

## 8. 남은 결정 사항

- [x] 헤어졌을 때: 운영자가 판단해 방을 삭제한다
- [x] 서버 코드 실행 방식: Cloudflare Workers
- [ ] 공동 운영자: 둘 경우 Firestore `config/admins`의 `emails`에 추가만 하면 된다(규칙 재배포 불필요)
- [ ] 오래 안 쓰는 방: 무기한 보관할지, 기한을 둘지
- [x] 서비스 이름과 주소: `couple-message` → `couple-message.2369-ryan.workers.dev`

## 9. 구현 로드맵

| 단계 | 작업 | 완료 기준 |
| --- | --- | --- |
| 1. 뼈대 | Firebase 프로젝트·Worker 골격, `crypto.ts`, 로그인 화면, `/create`·`/login`, custom token 로그인 | 두 기기에서 각자 입력해 같은 방에 들어감. crypto 고정 벡터 테스트 통과 |
| 2. 핵심 기능 | 연락처 칸, 편지 쓰기·목록·읽음, 암호화 저장, `firestore.rules` | 에뮬레이터 규칙 테스트: 다른 방 접근·목록 조회·상대 연락처 수정·편지 위조 모두 거부 |
| 3. 알림과 앱화 | manifest·서비스 워커, 홈 화면 안내, FCM 등록, `/notify`, 새 기기 알림, 잠금 | 아이폰 홈 화면 앱·안드로이드 크롬에서 푸시 수신. 5회 실패 후 잠금 확인 |
| 4. 운영 | 운영자 화면(초대 발급, 방 현황, 삭제), `/admin/delete-room` | 운영자 외 계정으로 admin 접근 불가. 삭제 후 하위 문서까지 사라짐 |
| 5. 시범 사용 | 건우 커플이 직접 사용하며 수정 | 2주 이상 문제없이 사용 |
| 6. 공개 | 친한 커플에게 초대 코드 배포 | — |
