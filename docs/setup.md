# 설치와 배포

1단계 기준. 아래 `<프로젝트ID>`가 곧 서비스 주소 `<프로젝트ID>.web.app`가 된다.

## 1. Firebase 프로젝트

1. https://console.firebase.google.com 에서 프로젝트 생성 (Spark 무료 요금제 그대로, 결제 수단 등록 불필요).
2. **Firestore Database** → 데이터베이스 만들기 → 프로덕션 모드, 위치 `asia-northeast3`(서울).
3. **Authentication** → 시작하기 → 로그인 방법에서 **Google**을 켠다(운영자 화면용). 커플은 custom token 이라 따로 켤 것이 없다.
4. 프로젝트 설정 → 일반 → 웹 앱 추가 → 나온 구성 값을 `web/.env.local`에 넣는다 (`web/.env.example` 참고).
   - 프로젝트 설정 → 클라우드 메시징 → **웹 푸시 인증서** → 키 쌍 생성 → `VITE_FIREBASE_VAPID_KEY`에 넣는다.
   - Google Cloud 콘솔에서 이 프로젝트의 **Firebase Cloud Messaging API**가 사용 설정돼 있는지 확인한다(보통 기본으로 켜져 있음).
5. 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** → JSON 파일 다운로드. 이 파일은 저장소에 절대 커밋하지 않는다.
6. `.firebaserc`의 `CHANGE-ME`를 `<프로젝트ID>`로 바꾼다.

## 2. Cloudflare Worker

```sh
cd worker
npx wrangler login
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # 서비스 계정 JSON 내용을 붙여넣기
```

`wrangler.toml`의 `ALLOWED_ORIGINS`를 `https://<프로젝트ID>.web.app,https://<프로젝트ID>.firebaseapp.com`으로 바꾸고:

```sh
npx wrangler deploy
```

나온 주소(`https://couple-mailbox.<계정>.workers.dev`)를 `web/.env.local`의 `VITE_WORKER_URL`에 넣는다.

## 3. 웹 배포

```sh
npm install
npm run build
npx firebase-tools login
npx firebase-tools deploy --only hosting,firestore:rules
```

## 4. 운영자 등록과 초대 코드

1. Firestore 콘솔에서 문서를 하나 만든다: 컬렉션 `config`, 문서 ID `admins`, 필드 `emails` (array) = `["건우의 구글 이메일"]` (소문자).
   - 공동 운영자를 둘 때는 이 배열에 이메일을 추가하기만 하면 된다. 보안 규칙과 Worker가 모두 이 문서를 본다.
   - 이 문서는 콘솔에서만 고칠 수 있다(규칙상 클라이언트는 못 씀).
2. `https://<프로젝트ID>.web.app/admin` 에서 구글 로그인.
3. "초대 코드 만들기"에 별칭(예: "OO 커플")을 적으면 `ABCDE-23456` 꼴 코드가 나온다. 이 코드를 커플에게 전한다.
   - 운영자 화면에서는 방 현황(오래 연락 없는 순), 초대 코드 상태, 방 삭제를 할 수 있다. 편지·연락처 내용은 보이지 않는다.

## 배포 후 확인 (실제 기기)

에뮬레이터로는 실제 푸시 수신을 확인할 수 없다. 배포 후 두 사람 휴대폰으로 확인한다.

- [ ] 아이폰 Safari로 열면 "홈 화면에 추가" 안내가 나온다. 추가한 아이콘으로 열면 "알림 받기"가 나온다 (iOS 16.4 이상).
- [ ] 안드로이드 크롬에서 "알림 받기" → 허용.
- [ ] 한 사람이 편지를 보내면, 앱을 닫아 둔 상대 휴대폰에 "새 편지가 왔어요" 알림이 온다. 누르면 우체통이 열린다.
- [ ] 연락처를 고치면 상대에게 "상대 연락처가 바뀌었어요" 알림.
- [ ] 다른 브라우저(새 기기)로 들어가면 두 사람 휴대폰에 새 기기 알림.
- [ ] 틀린 정보로 5번 들어가 보면 6번째부터 "너무 많이 틀렸어요" (같은 와이파이의 상대도 15분 동안 막히니 주의).
- [ ] 비행기 모드에서 앱을 열어도 마지막으로 본 편지와 연락처가 보인다.
- [ ] `/admin`에서 구글 팝업 로그인이 된다 (에뮬레이터에서는 이메일 입력식 가짜 로그인만 시험했다). 목록에 없는 계정은 "운영자 계정이 아니에요".

## 로컬 개발

### Firebase 프로젝트 없이 (에뮬레이터, Java 11 이상 필요)

```sh
npm run emulators                 # 터미널 1: Auth·Firestore 에뮬레이터
npm run dev:emulator -w worker    # 터미널 2: 에뮬레이터용 Worker, 초대 코드 DEVINVITE, 운영자 admin@example.com
npm run dev -w web                # 터미널 3: http://localhost:5173
```

`web/.env.local`:

```
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_PROJECT_ID=demo-couple-mailbox
VITE_FIREBASE_AUTH_DOMAIN=demo-couple-mailbox.firebaseapp.com
VITE_FIREBASE_APP_ID=1:1:web:1
VITE_WORKER_URL=http://localhost:8787
VITE_USE_EMULATORS=true
```

두 사람을 시험하려면 일반 창과 시크릿 창을 하나씩 쓰면 된다. 운영자 화면은 http://localhost:5173/admin.html 이고, 에뮬레이터에서는 이메일만 넣는 가짜 구글 로그인이 함께 나온다(배포 빌드에는 들어가지 않음). 에뮬레이터를 끄면 데이터는 사라진다.
에뮬레이터용 Worker는 푸시를 실제로 보내지 않고 터미널에 `[push] ...`로 찍는다. 모든 요청이 같은 IP(127.0.0.1)라서, 일부러 틀려 보면 잠금이 걸린다(Worker를 다시 시작해도 풀리지 않으니 에뮬레이터를 다시 시작).

### 실제 Firebase 프로젝트로

```sh
cp worker/.dev.vars.example worker/.dev.vars   # 서비스 계정 JSON을 한 줄로
npm run dev -w worker                          # http://localhost:8787
npm run dev -w web                             # http://localhost:5173
```

## 확인

```sh
npm test            # crypto 고정 벡터, Worker 핸들러, JWT 서명
npm run test:rules  # 보안 규칙 (Firestore 에뮬레이터, Java 필요)
npm run typecheck
```

## 서비스 계정 키가 유출됐을 때

1. 콘솔 → 서비스 계정에서 새 키 생성
2. `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT`로 교체
3. Google Cloud 콘솔 → IAM → 서비스 계정 → 키 목록에서 옛 키 삭제
