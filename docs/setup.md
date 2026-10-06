# 설치와 배포

구성: **Cloudflare Worker 하나**가 화면 파일과 API(`/api/*`)를 같이 서빙하고, **Firebase**는 Firestore·로그인·푸시만 맡는다.
주소는 `https://couple-message.2369-ryan.workers.dev`. 내 컴퓨터에 아무것도 설치하지 않고 콘솔(웹 화면)만으로 설정할 수 있다.

> 비밀값은 하나뿐이다: **Firebase 서비스 계정 키(JSON)**. 이것만 Cloudflare 대시보드의 비밀(Secret)에 넣고, 채팅·저장소 어디에도 붙여 넣지 않는다.
> 나머지 Firebase 웹 설정값은 브라우저에 그대로 전달되는 공개값이라 `web/.env.production`에 커밋한다.

## 1. Firebase 프로젝트

https://console.firebase.google.com

1. **프로젝트 만들기**: 이름 `couple-mailbox` (프로젝트 ID 는 자동으로 붙는 것 그대로 둬도 된다). Google 애널리틱스는 꺼도 된다. 요금제는 Spark(무료) 그대로.
2. **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**.
3. **Authentication** → 시작하기 → 로그인 방법 → **Google** 사용 설정(운영자 화면용. 커플은 따로 켤 것 없음).
4. **프로젝트 설정(톱니) → 일반 → 내 앱 → 웹(</>)** 앱 추가(닉네임 아무거나, Hosting 체크 안 함) → 나오는 `firebaseConfig` 값을 `web/.env.production`에 넣는다.
   - `apiKey` → `VITE_FIREBASE_API_KEY`, `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`, `projectId` → `VITE_FIREBASE_PROJECT_ID`,
     `appId` → `VITE_FIREBASE_APP_ID`, `messagingSenderId` → `VITE_FIREBASE_MESSAGING_SENDER_ID`
5. **프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서 → 키 쌍 생성** → 키 값을 `VITE_FIREBASE_VAPID_KEY`에.
   - 같은 화면에서 "Firebase Cloud Messaging API (V1)"이 사용 설정돼 있는지 확인.
6. **Firestore → 규칙** 탭에 저장소의 `firestore.rules` 내용을 통째로 붙여 넣고 **게시**.
7. **Firestore → 데이터** 에서 문서 만들기: 컬렉션 `config`, 문서 ID `admins`, 필드 `emails` (array) = 운영자 구글 이메일(소문자).
   - 공동 운영자는 이 배열에 이메일만 추가하면 된다. 규칙과 Worker가 모두 이 문서를 본다(콘솔에서만 고칠 수 있음).
8. **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성** → JSON 파일 다운로드. 2단계에서 Cloudflare에 넣는다.

`web/.env.production`이 비어 있으면 빌드가 일부러 실패한다(Firebase에 못 붙는 앱이 배포되는 것을 막음).

## 2. Cloudflare 배포 (GitHub 연결)

https://dash.cloudflare.com

1. 가입 후 **Workers 및 Pages** 를 처음 열면 workers.dev **서브도메인**을 정하라고 한다(예: `kimryan`). 주소에 들어가니 짧게.
2. **애플리케이션 만들기 → Workers → Git 저장소 가져오기(Import a repository)** → GitHub 연결 → `couple-message` 선택.
3. 빌드 설정:
   - 프로젝트 이름: `couple-message` (`wrangler.toml`의 `name`과 같아야 한다)
   - 빌드 명령: `npm run build`
   - 배포 명령: `npx wrangler deploy`
   - 루트 디렉터리: `/` (비워 둠), 프로덕션 브랜치: `main`
4. 첫 배포가 끝나면 Worker → **설정 → 변수 및 비밀 → 추가** → 유형 **비밀(Secret)**, 이름 `FIREBASE_SERVICE_ACCOUNT`, 값은 1-8의 JSON 파일 내용을 통째로 붙여 넣기 → 배포.
5. 이후로는 `main`에 push 될 때마다 자동으로 빌드·배포된다. 배포 기록과 로그는 Worker 화면의 배포·로그 탭에서 본다.

## 3. Firebase에 배포 주소 알려 주기

**Authentication → 설정 → 승인된 도메인 → 도메인 추가**: `couple-message.2369-ryan.workers.dev`
(운영자 구글 로그인 팝업이 이 주소에서 열리려면 필요하다.)

## 4. 첫 사용

1. `https://couple-message.2369-ryan.workers.dev/admin` 에서 구글 로그인.
2. "초대 코드 만들기"에 별칭(예: "건우 커플")을 적으면 `ABCDE-23456` 꼴 코드가 나온다.
3. 한 사람이 메인 주소에서 "처음이에요"를 켜고 초대 코드와 다섯 가지 정보로 방을 만들고, 상대는 초대 코드 없이 들어온다.

## 배포 후 확인 (실제 기기)

에뮬레이터로는 실제 푸시 수신과 구글 팝업 로그인을 확인할 수 없다. 배포 후 두 사람 휴대폰으로 확인한다.

- [ ] `/admin`에서 구글 팝업 로그인이 된다. 목록에 없는 계정은 "운영자 계정이 아니에요".
- [ ] 아이폰 Safari로 열면 "홈 화면에 추가" 안내가 나온다. 추가한 아이콘으로 열면 "알림 받기"가 나온다 (iOS 16.4 이상).
- [ ] 안드로이드 크롬에서 "알림 받기" → 허용.
- [ ] 한 사람이 편지를 보내면, 앱을 닫아 둔 상대 휴대폰에 "새 편지가 왔어요" 알림이 온다. 누르면 우체통이 열린다.
- [ ] 연락처를 고치면 상대에게 "상대 연락처가 바뀌었어요" 알림.
- [ ] 다른 브라우저(새 기기)로 들어가면 두 사람 휴대폰에 새 기기 알림.
- [ ] 틀린 정보로 5번 들어가 보면 6번째부터 "너무 많이 틀렸어요" (같은 와이파이의 상대도 15분 동안 막히니 주의).
- [ ] 비행기 모드에서 앱을 열어도 마지막으로 본 편지와 연락처가 보인다.

## 로컬 개발

### Firebase 프로젝트 없이 (에뮬레이터, Java 11 이상 필요)

```sh
npm install
cp web/.env.example web/.env.local
npm run emulators                 # 터미널 1: Auth·Firestore 에뮬레이터
npm run dev:emulator -w worker    # 터미널 2: 에뮬레이터용 Worker(8787), 초대 코드 DEVINVITE, 운영자 admin@example.com
npm run dev -w web                # 터미널 3: http://localhost:5173 (/api 는 8787 로 넘어감)
```

두 사람을 시험하려면 일반 창과 시크릿 창을 하나씩 쓰면 된다. 운영자 화면은 http://localhost:5173/admin.html 이고, 에뮬레이터에서는 이메일만 넣는 가짜 구글 로그인이 함께 나온다(배포 빌드에는 들어가지 않음). 에뮬레이터를 끄면 데이터는 사라진다.
에뮬레이터용 Worker는 푸시를 실제로 보내지 않고 터미널에 `[push] ...`로 찍는다. 모든 요청이 같은 IP(127.0.0.1)라서, 일부러 틀려 보면 잠금이 걸린다(에뮬레이터를 다시 시작하면 풀림).

### 실제 Firebase 프로젝트로

```sh
cp .dev.vars.example .dev.vars   # 서비스 계정 JSON을 한 줄로 (커밋 안 됨)
npm run build && npm run dev:worker   # 배포와 같은 구성(화면 + /api)을 http://localhost:8787 에서
```

## 확인

```sh
npm test            # crypto 고정 벡터, Worker 핸들러, JWT 서명
npm run test:rules  # 보안 규칙 (Firestore 에뮬레이터, Java 필요)
npm run typecheck
```

## 서비스 계정 키가 유출됐을 때

1. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정에서 새 키 생성
2. Cloudflare → Worker → 설정 → 변수 및 비밀에서 `FIREBASE_SERVICE_ACCOUNT` 값을 새 키로 교체
3. Google Cloud 콘솔 → IAM 및 관리자 → 서비스 계정 → 키 목록에서 옛 키 삭제
