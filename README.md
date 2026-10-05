# 커플 우체통

공부 때문에 자주 연락하기 어려운 커플이 가끔 안부 편지를 남기고, 바뀐 연락처를 알리고, 기기·번호·SNS가 모두 바뀌어도 다섯 가지 정보(두 사람의 이름·생일, 사귄 날)만으로 같은 방에 다시 들어올 수 있게 해주는 초대제 웹앱(PWA).

- 기획서: [docs/spec.md](docs/spec.md)
- 설계 문서: [docs/design.md](docs/design.md)

구성: Firebase(Hosting, Firestore, Auth, Cloud Messaging) + Cloudflare Workers(로그인 잠금·푸시 전송) + Vite/Vanilla TypeScript.
