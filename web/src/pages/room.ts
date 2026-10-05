import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { daysTogether } from '../dday';
import { db } from '../firebase';
import type { Session } from '../session';

interface Options {
  onLeave: (notice?: string) => void;
}

const TEMPLATE = `
  <header class="brand">
    <h1>우리 우체통</h1>
    <p class="dday"></p>
  </header>
  <section class="card">
    <p class="status">방을 여는 중…</p>
  </section>
  <button type="button" class="link leave">이 기기에서 나가기</button>
`;

export function renderRoom(root: HTMLElement, session: Session, { onLeave }: Options) {
  root.innerHTML = TEMPLATE;
  root.querySelector('.dday')!.textContent = `사귄 지 ${daysTogether(session.anniversary)}일`;
  const status = root.querySelector<HTMLElement>('.status')!;
  root.querySelector('.leave')!.addEventListener('click', () => onLeave());

  getDoc(doc(db, 'rooms', session.roomId))
    .then((snap) => {
      if (!snap.exists()) {
        onLeave('방이 더 이상 없어요.');
        return;
      }
      const createdAt = snap.get('createdAt') as Timestamp | undefined;
      status.textContent = createdAt
        ? `${createdAt.toDate().toLocaleDateString('ko-KR')}에 만든 방이에요. 연락처 칸과 편지는 곧 열려요.`
        : '방에 들어왔어요.';
    })
    .catch((err: { code?: string }) => {
      if (err.code === 'permission-denied') onLeave('다시 로그인해 주세요.');
      else status.textContent = '방을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
    });
}
